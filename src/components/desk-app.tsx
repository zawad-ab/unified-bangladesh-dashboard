import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Moon, RefreshCw, Sun } from "lucide-react";
import { AnalysisPanel } from "@/components/desk/analysis-panel";
import { relativeTime, StoryCard } from "@/components/desk/story-card";
import { getDesk, readStory, refreshDesk, writeBrief } from "@/lib/news/desk.functions";
import { loadBrief, loadDeskCache, saveBrief, saveDeskCache } from "@/lib/news/idb";
import { SOURCES } from "@/lib/news/sources";
import {
  CATEGORIES,
  type Brief,
  type Category,
  type DeskPayload,
  type Story,
} from "@/lib/news/types";

type ThemeChoice = "system" | "light" | "dark";

type Prefs = {
  theme: ThemeChoice;
  compact: boolean;
  glance: boolean;
  categories: Category[];
  blocked: string[];
};

const PREFS_KEY = "padma-prefs";
const THEME_KEY = "padma-theme";
const COOLDOWN_MS = 5 * 60 * 1000;
const BRIEF_CAP = 6;

const DEFAULT_PREFS: Prefs = {
  theme: "system",
  compact: false,
  glance: true,
  categories: [],
  blocked: [],
};

declare global {
  interface Window {
    NewsDashboard?: {
      refresh: () => void;
      filter: (categories: string[]) => void;
      export: () => void;
      glance: (on: boolean) => void;
    };
  }
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function dhakaParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function needsMorningPull(fetchedAt: string | null): boolean {
  if (!fetchedAt || fetchedAt.startsWith("1970")) return false;
  const now = dhakaParts();
  if (now.hour < 6) return false;
  const last = dhakaParts(new Date(fetchedAt));
  if (last.day < now.day) return true;
  return last.day === now.day && last.hour < 6;
}

function applyTheme(theme: ThemeChoice) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode */
  }
}

function clockLabel(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function dateLabel(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DeskApp({ initial }: { initial: DeskPayload }) {
  const refreshFn = useServerFn(refreshDesk);
  const loadFn = useServerFn(getDesk);
  const briefFn = useServerFn(writeBrief);
  const readFn = useServerFn(readStory);

  const [desk, setDesk] = useState(initial);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [prefsReady, setPrefsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [excerpts, setExcerpts] = useState<Record<string, string>>({});
  const [readingId, setReadingId] = useState<string | null>(null);
  const [briefs, setBriefs] = useState<Record<string, Brief>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [gated, setGated] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [light, setLight] = useState<string | null>(null);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [darkUi, setDarkUi] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const deskRef = useRef(desk);
  deskRef.current = desk;
  const pulling = useRef(false);
  const briefCount = useRef(0);
  const briefsPaused = useRef(false);
  const toastTimer = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const ping = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const pull = useCallback(
    async (reason: "manual" | "auto" | "morning") => {
      if (pulling.current) return;
      const current = deskRef.current;
      if (reason === "manual" && current.stories.length) {
        const age = Date.now() - new Date(current.fetchedAt).getTime();
        if (age >= 0 && age < COOLDOWN_MS) {
          const mins = Math.max(1, Math.ceil((COOLDOWN_MS - age) / 60000));
          ping(`The desk was just pulled. Try again in ${mins} min.`);
          return;
        }
      }
      pulling.current = true;
      setLoading(true);
      try {
        const next = reason === "auto" ? await loadFn() : await refreshFn({ data: {} });
        if (next.stories.length === 0) {
          console.error("[padma] empty desk", next.warnings);
          const cached = await loadDeskCache();
          if (cached?.stories.length) {
            setDesk(cached);
            ping("The wires did not answer. Showing the saved desk.");
          } else {
            setDesk(next);
            ping("The wires did not answer.");
          }
        } else {
          setDesk(next);
          if (next.failedSources.length) console.error("[padma] missed", next.failedSources);
          if (reason === "morning") ping("Morning pull — 06:00 Dhaka.");
          else if (reason === "manual") ping("Desk updated.");
        }
      } catch (err) {
        console.error("[padma] pull failed", err);
        const cached = await loadDeskCache();
        if (cached?.stories.length) setDesk(cached);
        ping("Could not reach the wires. The saved desk stays up.");
      } finally {
        pulling.current = false;
        setLoading(false);
      }
    },
    [loadFn, ping, refreshFn],
  );
  const pullRef = useRef(pull);
  pullRef.current = pull;

  const requestBrief = useCallback(
    async (story: Story, force: boolean) => {
      if (briefs[story.id]) return;
      const saved = await loadBrief(story.id);
      if (saved) {
        setBriefs((map) => ({ ...map, [story.id]: saved }));
        setBriefError(null);
        setGated(false);
        return;
      }
      if (!force && briefsPaused.current) {
        setBriefError("Written briefs are paused until desk credits are restored.");
        setGated(false);
        return;
      }
      setBriefError(null);
      if (!force && briefCount.current >= BRIEF_CAP) {
        setGated(true);
        return;
      }
      setGated(false);
      setBusyId(story.id);
      briefCount.current += 1;
      try {
        const result = await briefFn({
          data: {
            id: story.id,
            title: story.title,
            summary: story.summary,
            source: story.source,
            related: story.related.map((rel) => `${rel.source}: ${rel.title}`),
          },
        });
        if (!result.ok) {
          briefCount.current = Math.max(0, briefCount.current - 1);
          if (/credits|paused/i.test(result.error)) briefsPaused.current = true;
          setBriefError(result.error);
          console.error("[padma] brief", result.error);
          return;
        }
        setBriefs((map) => ({ ...map, [story.id]: result.brief }));
        await saveBrief(story.id, result.brief);
      } catch (err) {
        briefCount.current = Math.max(0, briefCount.current - 1);
        console.error("[padma] brief", err);
        setBriefError("The brief could not be written.");
      } finally {
        setBusyId((id) => (id === story.id ? null : id));
      }
    },
    [briefFn, briefs],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Prefs>;
        setPrefs({
          ...DEFAULT_PREFS,
          ...parsed,
          categories: Array.isArray(parsed.categories) ? parsed.categories.filter(isCategory) : [],
          blocked: Array.isArray(parsed.blocked)
            ? parsed.blocked.filter((x) => typeof x === "string")
            : [],
        });
      }
      const theme = localStorage.getItem(THEME_KEY);
      if (theme === "light" || theme === "dark" || theme === "system") {
        setPrefs((p) => ({ ...p, theme }));
        applyTheme(theme);
      }
    } catch (err) {
      console.error("[padma] prefs", err);
    }
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
    applyTheme(prefs.theme);
  }, [prefs, prefsReady]);

  useEffect(() => {
    if (desk.stories.length) void saveDeskCache(desk);
  }, [desk]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const compute = () => {
      const theme = prefsRef.current.theme;
      setDarkUi(theme === "dark" || (theme === "system" && mq.matches));
    };
    compute();
    mq.addEventListener("change", compute);
    return () => mq.removeEventListener("change", compute);
  }, [prefs.theme]);

  useEffect(() => {
    const age = Date.now() - new Date(initial.fetchedAt).getTime();
    if (initial.stories.length === 0) {
      void loadDeskCache().then((cached) => {
        if (cached?.stories.length) setDesk(cached);
      });
      void pullRef.current("auto");
      return;
    }
    if (needsMorningPull(initial.fetchedAt) || age > 45 * 60 * 1000) void pullRef.current("auto");
  }, [initial.fetchedAt, initial.stories.length]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
      if (needsMorningPull(deskRef.current.fetchedAt)) void pullRef.current("morning");
    }, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible" && needsMorningPull(deskRef.current.fetchedAt)) {
        void pullRef.current("morning");
      }
    };
    const onOnline = () => {
      ping("Back online. Pulling the desk.");
      void pullRef.current("auto");
    };
    const onOffline = () => ping("Offline. You are reading the saved desk.");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [ping]);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let drop = false;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        const sync = (
          reg as ServiceWorkerRegistration & {
            periodicSync?: {
              register: (tag: string, opts: { minInterval: number }) => Promise<void>;
            };
          }
        ).periodicSync;
        sync?.register("padma-morning", { minInterval: 12 * 60 * 60 * 1000 }).catch(() => {});
      })
      .catch((err) => console.error("[padma] service worker", err));
    const onMsg = (event: MessageEvent) => {
      if (drop) return;
      const data = event.data as { type?: string; desk?: DeskPayload } | null;
      if (data?.type === "padma-desk" && data.desk?.stories?.length) setDesk(data.desk);
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => {
      drop = true;
      navigator.serviceWorker.removeEventListener("message", onMsg);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setLight(null);
      setShortcutOpen(false);
      setSelectedId(null);
      window.speechSynthesis?.cancel();
      setSpeakingId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  const exportDesk = useCallback(() => {
    download(
      "padma-brief.json",
      JSON.stringify({ exportedAt: new Date().toISOString(), ...deskRef.current }, null, 2),
      "application/json",
    );
    ping("Exported the desk.");
  }, [ping]);

  useEffect(() => {
    window.NewsDashboard = {
      refresh: () => {
        void pull("manual");
      },
      filter: (categories: string[]) => {
        setPrefs((p) => ({ ...p, categories: categories.filter(isCategory), glance: false }));
      },
      export: () => exportDesk(),
      glance: (on: boolean) => setPrefs((p) => ({ ...p, glance: on })),
    };
    return () => {
      delete window.NewsDashboard;
    };
  }, [exportDesk, pull]);

  const visible = useMemo(() => {
    const filtered = desk.stories.filter((story) => {
      if (prefs.blocked.includes(story.source)) return false;
      if (
        prefs.categories.length &&
        !story.categories.some((cat) => prefs.categories.includes(cat))
      )
        return false;
      return true;
    });
    if (!prefs.glance) return filtered;
    const hot = filtered.filter(
      (story) => story.importance === "breaking" || story.importance === "high",
    );
    const focused = hot.filter(
      (story) =>
        story.categories.includes("bangladesh") &&
        story.categories.some(
          (cat) =>
            cat === "geopolitics" || cat === "economy" || cat === "climate" || cat === "health",
        ),
    );
    const rest = hot.filter((story) => !focused.includes(story));
    const ordered = focused.length >= 3 ? [...focused, ...rest] : hot;
    return ordered.slice(0, 10);
  }, [desk.stories, prefs.blocked, prefs.categories, prefs.glance]);

  const selected = desk.stories.find((story) => story.id === selectedId) ?? null;

  const counts = useMemo(() => {
    const base = Object.fromEntries(CATEGORIES.map((cat) => [cat.id, 0])) as Record<
      Category,
      number
    >;
    for (const story of desk.stories) {
      if (prefs.blocked.includes(story.source)) continue;
      for (const cat of story.categories) base[cat] += 1;
    }
    return base;
  }, [desk.stories, prefs.blocked]);

  async function expand(story: Story) {
    setSelectedId(story.id);
    setExpandedId((id) => (id === story.id ? null : story.id));
    if (excerpts[story.id] != null || story.url.includes("news.google.com")) return;
    setReadingId(story.id);
    try {
      const result = await readFn({ data: { url: story.url } });
      setExcerpts((map) => ({
        ...map,
        [story.id]: result.ok && !result.externalOnly ? result.text : "",
      }));
    } catch (err) {
      console.error("[padma] read", err);
      setExcerpts((map) => ({ ...map, [story.id]: "" }));
      ping("Could not open that filing. Use the outlet link.");
    } finally {
      setReadingId((id) => (id === story.id ? null : id));
    }
  }

  function speak(story: Story) {
    const synth = window.speechSynthesis;
    if (!synth) {
      ping("This browser has no spoken voice.");
      return;
    }
    if (speakingId === story.id) {
      synth.cancel();
      setSpeakingId(null);
      return;
    }
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(`${story.title}. ${story.summary}`);
    utter.lang = "en-US";
    utter.onend = () => setSpeakingId(null);
    setSpeakingId(story.id);
    synth.speak(utter);
  }

  function toggleCategory(id: Category) {
    setPrefs((p) => {
      const has = p.categories.includes(id);
      return {
        ...p,
        categories: has ? p.categories.filter((c) => c !== id) : [...p.categories, id],
      };
    });
  }

  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const nodes = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-story]") ?? [])];
    if (!nodes.length) return;
    const index = nodes.findIndex((node) => node === document.activeElement);
    event.preventDefault();
    const next =
      event.key === "ArrowDown"
        ? Math.min(nodes.length - 1, index < 0 ? 0 : index + 1)
        : Math.max(0, index < 0 ? 0 : index - 1);
    nodes[next]?.focus();
  }

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const pulled = desk.fetchedAt.startsWith("1970")
    ? "not yet pulled"
    : `${relativeTime(desk.fetchedAt, now.getTime())} ago`;

  return (
    <div className="min-h-screen pb-24">
      <a
        href="#wires"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper"
      >
        Skip to wires
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-5">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-accent uppercase">
              <span className="inline-block size-2.5 rounded-full bg-signal" aria-hidden />
              Bay of Bengal desk
            </p>
            <h1 className="font-serif text-4xl text-balance text-ink sm:text-5xl">Padma Brief</h1>
            <p className="mt-1 max-w-md font-serif text-lg italic text-pretty text-muted">
              Morning wires for Dhaka, the delta, and the powers around them.
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="font-serif text-3xl text-ink tabular-nums" suppressHydrationWarning>
              {clockLabel(now)}
            </p>
            <p className="text-sm text-muted" suppressHydrationWarning>
              {dateLabel(now)} · Dhaka
            </p>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-4">
          <div className="h-0.5 bg-ink" />
          <div className="mt-px h-px bg-ink" />
        </div>
      </header>

      <div className="sticky top-0 z-20 border-b border-line bg-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <button
            type="button"
            aria-pressed={prefs.categories.length === 0}
            onClick={() => setPrefs((p) => ({ ...p, categories: [] }))}
            className={chip(prefs.categories.length === 0)}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              aria-pressed={prefs.categories.includes(cat.id)}
              onClick={() => toggleCategory(cat.id)}
              className={chip(prefs.categories.includes(cat.id))}
            >
              {cat.label}
            </button>
          ))}
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden />
          <button
            type="button"
            aria-pressed={prefs.glance}
            onClick={() => setPrefs((p) => ({ ...p, glance: !p.glance }))}
            className={chip(prefs.glance)}
          >
            {prefs.glance ? "Morning glance" : "Full desk"}
          </button>
          <button
            type="button"
            onClick={() => void pull("manual")}
            disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 border border-line px-3 text-sm text-ink transition-transform duration-150 ease-out active:scale-[0.96] disabled:opacity-60"
          >
            <RefreshCw className={cx("size-4", loading && "animate-spin")} aria-hidden />
            {loading ? "Pulling" : "Pull wires"}
          </button>
          <button
            type="button"
            aria-label={prefs.theme === "dark" ? "Switch to light" : "Switch to dark"}
            onClick={() => setPrefs((p) => ({ ...p, theme: darkUi ? "light" : "dark" }))}
            className="inline-flex size-11 items-center justify-center border border-line text-ink transition-transform duration-150 ease-out active:scale-[0.96]"
          >
            {darkUi ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
        </div>
      </div>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-muted tabular-nums" suppressHydrationWarning>
              {desk.sourceCount || SOURCES.length} outlets · {visible.length}{" "}
              {prefs.glance ? "morning wires" : "stories"} · pulled {pulled}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={exportDesk}
                className="inline-flex min-h-11 items-center gap-2 text-sm text-muted"
              >
                <Download className="size-4" aria-hidden />
                Export
              </button>
              <button
                type="button"
                onClick={() => setShortcutOpen(true)}
                className="inline-flex min-h-11 items-center text-sm text-accent"
              >
                Desk shortcut
              </button>
            </div>
          </div>
          {desk.failedSources.length > 0 && (
            <p className="mb-4 text-sm text-muted">
              Missed this pull: {desk.failedSources.join(", ")}.
            </p>
          )}
          <div id="wires" ref={listRef} className="space-y-3" onKeyDown={onListKey}>
            {visible.length === 0 && (
              <div className="border border-line bg-card px-4 py-8">
                <h2 className="font-serif text-2xl text-ink">The morning bar is clear</h2>
                <p className="mt-2 max-w-md text-sm text-pretty text-muted">
                  {prefs.glance
                    ? "Nothing in this filter cleared breaking or high. Open the full desk, or pull the wires again."
                    : "No wires match this filter."}
                </p>
                {prefs.glance && (
                  <button
                    type="button"
                    className="mt-4 inline-flex min-h-11 items-center bg-ink px-3 text-sm text-paper"
                    onClick={() => setPrefs((p) => ({ ...p, glance: false }))}
                  >
                    Open full desk
                  </button>
                )}
              </div>
            )}
            {visible.map((story, index) => (
              <StoryCard
                key={story.id}
                story={story}
                lead={index === 0}
                selected={story.id === selectedId}
                compact={prefs.compact}
                expanded={expandedId === story.id}
                excerpt={excerpts[story.id] ?? null}
                reading={readingId === story.id}
                speaking={speakingId === story.id}
                onSelect={() => {
                  setSelectedId(story.id);
                  setGated(false);
                  setBriefError(null);
                  void requestBrief(story, false);
                }}
                onExpand={() => void expand(story)}
                onSpeak={() => speak(story)}
                onOpenImage={setLight}
              />
            ))}
          </div>
          <details className="mt-6 border border-line bg-card px-4 py-3">
            <summary className="min-h-11 text-sm font-medium text-ink">Desk settings</summary>
            <div className="mt-3 space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                {(["system", "light", "dark"] as ThemeChoice[]).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    aria-pressed={prefs.theme === theme}
                    onClick={() => setPrefs((p) => ({ ...p, theme }))}
                    className={chip(prefs.theme === theme)}
                  >
                    {theme}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={prefs.compact}
                  onClick={() => setPrefs((p) => ({ ...p, compact: !p.compact }))}
                  className={chip(prefs.compact)}
                >
                  Compact
                </button>
              </div>
              <fieldset>
                <legend className="text-muted">Outlets to hide</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {SOURCES.map((source) => (
                    <label key={source.id} className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={prefs.blocked.includes(source.name)}
                        onChange={() =>
                          setPrefs((p) => ({
                            ...p,
                            blocked: p.blocked.includes(source.name)
                              ? p.blocked.filter((name) => name !== source.name)
                              : [...p.blocked, source.name],
                          }))
                        }
                      />
                      <span>{source.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </details>
          <footer className="mt-8 border-t border-line pt-4 text-sm text-pretty text-muted">
            <p>
              Padma Brief reads public wires. It does not republish whole articles. A written brief
              is requested when you open a story, then stored on this device. The morning pull is
              06:00 Asia/Dhaka.
            </p>
            <p className="mt-2">
              Keyboard: Tab to a wire, Enter opens the filing, arrows move between wires, Escape
              closes the brief.
            </p>
          </footer>
        </div>

        <aside
          className={cx(
            selected
              ? "fixed inset-0 z-30 overflow-y-auto bg-paper p-4 pb-16 lg:static lg:z-auto lg:overflow-visible lg:bg-transparent lg:p-0"
              : "hidden lg:block",
          )}
        >
          <div className="lg:sticky lg:top-16 lg:max-h-screen lg:overflow-y-auto lg:pb-10">
            <AnalysisPanel
              story={selected}
              brief={selected ? (briefs[selected.id] ?? null) : null}
              busy={!!selected && busyId === selected.id}
              error={briefError}
              gated={gated}
              counts={counts}
              onWrite={() => {
                if (selected) void requestBrief(selected, true);
              }}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </aside>
      </main>

      {light && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image"
          className="fixed inset-0 z-40 flex items-center justify-center bg-ink p-4"
          onClick={() => setLight(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 inline-flex min-h-11 items-center bg-paper px-3 text-sm text-ink"
            onClick={() => setLight(null)}
          >
            Close
          </button>
          <img
            src={light}
            alt=""
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {shortcutOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcut-title"
          className="veil fixed inset-0 z-40 flex items-end justify-center p-4 sm:items-center"
        >
          <div className="w-full max-w-lg bg-paper p-5 text-ink">
            <h2 id="shortcut-title" className="font-serif text-2xl">
              Install a desk shortcut
            </h2>
            <p className="mt-2 text-sm text-pretty text-muted">
              Download a launcher that opens this desk in a browser window. On Windows, run the
              PowerShell script for an app-style window. On Mac, use the command file. Pin the
              result to your dock or taskbar.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex min-h-11 items-center bg-ink px-3 text-sm text-paper"
                onClick={() => saveLaunchers(origin)}
              >
                Download launchers
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center border border-line px-3 text-sm"
                onClick={() => setShortcutOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 max-w-sm -translate-x-1/2 bg-ink px-4 py-3 text-sm text-paper"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function chip(on: boolean) {
  return cx(
    "inline-flex min-h-11 items-center px-3 text-sm transition-transform duration-150 ease-out active:scale-[0.96]",
    on ? "bg-ink text-paper" : "border border-line text-ink",
  );
}

function isCategory(value: unknown): value is Category {
  return CATEGORIES.some((cat) => cat.id === value);
}

function saveLaunchers(origin: string) {
  const url = origin || "https://padma-brief.example";
  download("padma-brief.url", `[InternetShortcut]\r\nURL=${url}/\r\n`, "text/plain");
  download(
    "padma-brief.webloc",
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>URL</key><string>${url}/</string></dict></plist>\n`,
    "application/xml",
  );
  download(
    "padma-brief.ps1",
    `$url = "${url}/"\n$chrome = "$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe"\n$edge = "$env:ProgramFiles(x86)\\Microsoft\\Edge\\Application\\msedge.exe"\nif (Test-Path $chrome) { Start-Process $chrome "--app=$url" }\nelseif (Test-Path $edge) { Start-Process $edge "--app=$url" }\nelse { Start-Process $url }\n`,
    "text/plain",
  );
  download(
    "padma-brief.command",
    `#!/bin/sh\nopen -na "Google Chrome" --args --app="${url}/" || open "${url}/"\n`,
    "text/plain",
  );
}
