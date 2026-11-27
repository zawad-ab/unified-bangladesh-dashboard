import { X, Play, Pause } from "lucide-react";
import type { ReactNode } from "react";
import { CATEGORIES, type Brief, type Category, type Story } from "@/lib/news/types";
import { SOURCES } from "@/lib/news/sources";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const TIER_COPY: Record<number, string> = {
  1: "Tier 1 · wire or major international",
  2: "Tier 2 · major national",
  3: "Tier 3 · regional or specialist",
};

export function AnalysisPanel({
  story,
  brief,
  busy,
  error,
  gated,
  counts,
  onWrite,
  onClose,
}: {
  story: Story | null;
  brief: Brief | null;
  busy: boolean;
  error: string | null;
  gated: boolean;
  counts: Record<Category, number>;
  onWrite: () => void;
  onClose: () => void;
}) {
  if (!story) {
    const max = Math.max(1, ...Object.values(counts));
    return (
      <div className="border border-line bg-card p-4">
        <p className="text-xs font-medium tracking-widest text-accent uppercase">The desk</p>
        <h2 className="mt-2 font-serif text-2xl text-balance text-ink">Select a wire</h2>
        <p className="mt-2 text-sm text-pretty text-muted">
          The column fills with cause and effect, players, and a short timeline. It is written from the
          filing on screen, then kept on this device.
        </p>
        <div className="mt-5 space-y-2">
          {CATEGORIES.map((cat) => (
            <div key={cat.id} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-sm">
              <span className="text-muted">{cat.label}</span>
              <span className="h-1.5 bg-line">
                <span className="block h-full bg-ink" style={{ width: `${(counts[cat.id] / max) * 100}%` }} />
              </span>
              <span className="text-right text-muted tabular-nums">{counts[cat.id]}</span>
            </div>
          ))}
        </div>
        <ul className="mt-6 space-y-2 border-t border-line pt-4 text-sm">
          {SOURCES.map((source) => (
            <li key={source.id} className="flex items-baseline justify-between gap-3">
              <span className="text-ink">{source.name}</span>
              <span className="shrink-0 text-muted">Tier {source.tier}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const filled = 4 - story.tier;

  return (
    <div className="border border-line bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="text-xs font-medium tracking-widest text-accent uppercase">Brief</p>
          <p className="mt-1 text-sm text-muted">{TIER_COPY[story.tier]}</p>
        </div>
        <button
          type="button"
          className="inline-flex size-11 items-center justify-center border border-line text-ink lg:hidden"
          onClick={onClose}
          aria-label="Close brief"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="space-y-5 px-4 py-4">
        <div>
          <div className="flex items-center gap-2" aria-label={TIER_COPY[story.tier]}>
            {[1, 2, 3].map((i) => (
              <span key={i} className={cx("h-1.5 w-8", i <= filled ? "bg-accent" : "bg-line")} />
            ))}
          </div>
          <p className="mt-3 font-serif text-xl text-balance text-ink">{story.title}</p>
          <p className="mt-2 text-sm text-muted">
            {story.outletCount > 1
              ? `${story.outletCount} outlets in this cluster`
              : "One outlet so far"}
            {story.verification === "verified" ? " · cross-checked" : ""}
          </p>
        </div>

        {story.youtubeId && (
          <div className="relative group">
            <iframe
              className="aspect-video w-full bg-ink rounded-lg"
              src={`https://www.youtube-nocookie.com/embed/${story.youtubeId}?autoplay=1&mute=1&rel=0&controls=1`}
              title={`Video: ${story.title}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              onMouseEnter={(e) => {
                const iframe = e.currentTarget as HTMLIFrameElement;
                iframe.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
              }}
            />
            <div className="absolute top-2 right-2 flex gap-1">
              <button
                className="inline-flex size-8 items-center justify-center bg-white/90 rounded-full shadow-lg hover:bg-white transition-all duration-200"
                onClick={() => {
                  const iframe = document.querySelector('iframe[src*="youtube-nocookie.com"]') as HTMLIFrameElement;
                  if (iframe) {
                    iframe.contentWindow?.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
                  }
                }}
                aria-label="Play video"
              >
                <Play className="size-4 text-ink" aria-hidden />
              </button>
              <button
                className="inline-flex size-8 items-center justify-center bg-white/90 rounded-full shadow-lg hover:bg-white transition-all duration-200"
                onClick={() => {
                  const iframe = document.querySelector('iframe[src*="youtube-nocookie.com"]') as HTMLIFrameElement;
                  if (iframe) {
                    iframe.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
                  }
                }}
                aria-label="Pause video"
              >
                <Pause className="size-4 text-ink" aria-hidden />
              </button>
            </div>
          </div>
        )}
        {!story.youtubeId && story.videoUrl && (
          <a href={story.videoUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm text-accent">
            Watch at {story.source}
          </a>
        )}

        <Section label="Cause and effect">
          {brief ? (
            <p className="text-pretty">{brief.causeEffect}</p>
          ) : (
            <Pending busy={busy} error={error} gated={gated} onWrite={onWrite} />
          )}
        </Section>

        <div className="grid gap-4 sm:grid-cols-2">
          <Section label="What it opens">
            {brief ? <List items={brief.pros} /> : <p className="text-sm text-muted">Waiting on the brief.</p>}
          </Section>
          <Section label="What it costs">
            {brief ? <List items={brief.cons} /> : <p className="text-sm text-muted">Waiting on the brief.</p>}
          </Section>
        </div>

        <Section label="Players">
          {brief ? (
            brief.players.length ? (
              <ul className="space-y-2">
                {brief.players.map((player) => (
                  <li key={player.name}>
                    <span className="text-ink">{player.name}</span>
                    <span className="text-muted"> — {player.role}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">No named players in the wires.</p>
            )
          ) : (
            <p className="text-sm text-muted">Waiting on the brief.</p>
          )}
        </Section>

        <Section label="Timeline">
          {brief ? (
            <ol className="space-y-3 border-l border-line pl-3">
              {brief.timeline.map((item) => (
                <li key={`${item.label}-${item.detail.slice(0, 24)}`}>
                  <p className="text-xs font-medium tracking-wide text-accent uppercase">{item.label}</p>
                  <p className="text-pretty">{item.detail}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">Waiting on the brief.</p>
          )}
        </Section>

        <Section label="Why it sits on this desk">
          {brief ? <p className="text-pretty">{brief.context}</p> : <p className="text-sm text-muted">Waiting on the brief.</p>}
        </Section>

        {brief && brief.topics.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {brief.topics.map((topic) => (
              <li key={topic} className="border border-line px-2 py-1 text-xs text-muted">
                {topic}
              </li>
            ))}
          </ul>
        )}

        {brief?.note && <p className="text-sm text-pretty text-muted">{brief.note}</p>}

        {story.related.length > 0 && (
          <Section label="Same story, other wires">
            <ul className="space-y-2">
              {story.related.map((rel) => (
                <li key={rel.url}>
                  <a href={rel.url} target="_blank" rel="noreferrer" className="text-ink underline decoration-line underline-offset-2">
                    {rel.source}: {rel.title}
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <p className="text-xs text-muted">Written from the wires on screen. Not a second source.</p>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-medium tracking-widest text-muted uppercase">{label}</h3>
      <div className="mt-2 text-sm leading-relaxed text-ink">{children}</div>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-muted">Not established by the wires.</p>;
  return (
    <ul className="list-disc space-y-1 pl-4">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Pending({
  busy,
  error,
  gated,
  onWrite,
}: {
  busy: boolean;
  error: string | null;
  gated: boolean;
  onWrite: () => void;
}) {
  if (busy) return <p className="text-sm text-muted">Reading the wires…</p>;
  if (gated || error) {
    return (
      <div>
        <p className="text-sm text-pretty text-muted">
          {error ?? "Open briefs are capped so this desk does not write one for every click."}
        </p>
        <button
          type="button"
          className="mt-3 inline-flex min-h-11 items-center bg-ink px-3 text-sm text-paper transition-transform duration-150 ease-out active:scale-[0.96]"
          onClick={onWrite}
        >
          {error && /credits|paused/i.test(error) ? "Try again" : "Write the brief"}
        </button>
      </div>
    );
  }
  return <p className="text-sm text-muted">The factual desk is up. The written brief follows.</p>;
}
