import { useRef, useState, useEffect } from "react";
import { ExternalLink, Volume2, VolumeX, Play, Pause, Image as ImageIcon, Youtube, X } from "lucide-react";
import type { Story } from "@/lib/news/types";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function getFavicon(url: string) {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return "";
  }
}

function initials(name: string) {
  const skip = new Set(["the", "of", "a", "and"]);
  const parts = name.split(/\s+/).filter((w) => !skip.has(w.toLowerCase()));
  if (parts.length <= 1) return (parts[0] ?? name).slice(0, 3).toUpperCase();
  return parts
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "Undated";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Undated";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "Undated";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "Undated";
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return "Just in";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function Plate({
  story,
  failed,
  onFail,
  onOpen,
  large,
}: {
  story: Story;
  failed: boolean;
  onFail: () => void;
  onOpen: (src: string) => void;
  large?: boolean;
}) {
  if (story.image && !failed) {
    return (
      <button
        type="button"
        className={cx(
          "relative block overflow-hidden bg-card transition-transform duration-150 ease-out active:scale-[0.96]",
          large ? "aspect-video w-full" : "h-24 w-32 shrink-0 sm:h-28 sm:w-40",
        )}
        onClick={() => onOpen(story.image!)}
        aria-label={`Open image from ${story.source}`}
      >
        <img
          src={story.image}
          alt=""
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={onFail}
        />
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent">
          <span className="text-xs font-medium text-paper/90">{story.source}</span>
        </div>
      </button>
    );
  }
  return (
    <div
      className={cx(
        "relative flex items-center justify-center bg-gradient-to-br from-card to-muted/30 text-accent",
        large ? "aspect-video w-full" : "h-24 w-32 shrink-0 sm:h-28 sm:w-40",
      )}
      aria-hidden
    >
      <div className="text-center p-4">
        <span className="font-serif text-3xl sm:text-4xl">{initials(story.source)}</span>
        <p className="mt-1 text-xs text-muted/70 uppercase tracking-wider">{story.source}</p>
      </div>
    </div>
  );
}

export function StoryCard({
  story,
  lead,
  selected,
  compact,
  expanded,
  excerpt,
  reading,
  speaking,
  onSelect,
  onExpand,
  onSpeak,
  onOpenImage,
}: {
  story: Story;
  lead: boolean;
  selected: boolean;
  compact: boolean;
  expanded: boolean;
  excerpt: string | null;
  reading: boolean;
  speaking: boolean;
  onSelect: () => void;
  onExpand: () => void;
  onSpeak: () => void;
  onOpenImage: (src: string) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const videoRef = useRef<HTMLIFrameElement>(null);
  const showImage = !compact;
  const google = story.url.includes("news.google.com");

  return (
    <article
      data-story={story.id}
      tabIndex={0}
      aria-selected={selected}
      className="group"
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button, a")) return;
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget) {
          event.preventDefault();
          onSelect();
          onExpand();
        }
      }}
      className={cx(
        "scroll-mt-24 border-l-4 bg-card px-4 py-4 outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        selected ? "border-l-accent" : "border-l-transparent",
        lead ? "sm:px-5 sm:py-5" : "",
      )}
    >
      <div className={cx(lead && showImage ? "sm:grid sm:grid-cols-5 sm:gap-5" : "flex gap-4")}>
        <div className={cx(lead && showImage ? "sm:col-span-3" : "min-w-0 flex-1")}>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium tracking-wide uppercase">
            <span className={story.importance === "breaking" ? "text-signal" : "text-ink"}>
              {story.importance === "breaking" ? "Breaking" : story.importance}
            </span>
            <span className="text-muted">Tier {story.tier}</span>
            <span className={story.verification === "verified" ? "text-accent" : "text-muted"}>
              {story.verification === "verified"
                ? "Cross-checked"
                : story.verification === "corroborated"
                  ? "Corroborated"
                  : "Single source"}
            </span>
            <span className="inline-flex items-center gap-1.5 text-accent">
              <img
                src={getFavicon(story.url)}
                alt=""
                className="size-3.5 rounded"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <span>{story.source}</span>
            </span>
            <span className="text-muted tabular-nums" suppressHydrationWarning>
              {relativeTime(story.publishedAt)}
            </span>
            <span className="hidden text-muted tabular-nums sm:inline" suppressHydrationWarning>
              {formatWhen(story.publishedAt)} Dhaka
            </span>
            <span className="text-muted tabular-nums">{story.readingMinutes} min</span>
          </p>
          <h2
            className={cx(
              "mt-2 font-serif text-balance text-ink",
              lead ? "text-3xl leading-tight sm:text-4xl" : "text-xl leading-snug",
            )}
          >
            {story.title}
          </h2>
          {story.summary && (
            <p
              className={cx(
                "mt-2 text-pretty text-muted",
                lead ? "font-serif text-lg italic" : "text-sm leading-relaxed",
              )}
            >
              {story.summary}
            </p>
          )}
          {story.related.length > 0 && (
            <p className="mt-3 text-sm text-muted">
              Also filed by {story.related.map((r) => r.source).join(", ")}
            </p>
          )}
          {story.youtubeId && (
            <div className="mt-3 relative group">
              <button
                type="button"
                className="relative aspect-video w-full overflow-hidden bg-ink rounded-lg transition-opacity duration-200 group-hover:opacity-90"
                onClick={() => setVideoOpen(true)}
                aria-label={`Play video: ${story.title}`}
              >
                <img
                  src={`https://img.youtube.com/vi/${story.youtubeId}/maxresdefault.jpg`}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity duration-200 opacity-0 group-hover:opacity-100">
                  <Play className="size-12 text-paper/90 group-hover:size-14 transition-transform duration-200" aria-hidden />
                </div>
                <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 bg-black/70 rounded text-xs text-paper">
                  <Youtube className="size-3" aria-hidden />
                  <span>{story.source}</span>
                </div>
              </button>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={cx(
                "inline-flex min-h-11 items-center px-3 text-sm font-medium transition-all duration-150",
                expanded
                  ? "bg-ink/80 text-paper hover:bg-ink"
                  : "bg-ink px-3 text-paper hover:bg-ink/90"
              )}
              onClick={onExpand}
              aria-expanded={expanded}
            >
              {expanded ? "Close filing" : "Read filing"}
            </button>
            <button
              type="button"
              className={cx(
                "inline-flex min-h-11 items-center gap-2 border border-line px-3 text-sm transition-all duration-150",
                speaking ? "bg-ink text-paper" : "bg-card text-ink hover:bg-muted"
              )}
              onClick={onSpeak}
            >
              {speaking ? (
                <>
                  <VolumeX className="size-4" aria-hidden />
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <Volume2 className="size-4" aria-hidden />
                  <span>Listen</span>
                </>
              )}
            </button>
            <a
              href={story.url}
              target="_blank"
              rel="noreferrer"
              className={cx(
                "inline-flex min-h-11 items-center gap-2 border border-line px-3 text-sm transition-all duration-150",
                "bg-card text-ink hover:bg-muted hover:border-accent/50"
              )}
            >
              <ExternalLink className="size-4" aria-hidden />
              <span>{story.source}</span>
            </a>
          </div>
          {expanded && (
            <div className="mt-4 border-t border-line pt-4 text-sm leading-relaxed text-ink">
              {google ? (
                <p className="text-pretty">
                  This wire points through Google News to {story.source}. The standfirst above is
                  the filing we were given. The full piece opens on the outlet.
                </p>
              ) : reading ? (
                <p className="text-muted">Opening the filing…</p>
              ) : excerpt ? (
                <div className="space-y-3 whitespace-pre-wrap text-pretty">{excerpt}</div>
              ) : (
                <p className="text-pretty text-muted">
                  The outlet did not send a readable excerpt. Continue on their site.
                </p>
              )}
              <p className="mt-3 text-muted">Excerpt only. The story stays at {story.source}.</p>
            </div>
          )}
        </div>
        {showImage && (
          <div className={cx(lead ? "mt-4 sm:col-span-2 sm:mt-0" : "shrink-0")}>
            <Plate
              story={story}
              failed={imgFailed}
              onFail={() => setImgFailed(true)}
              onOpen={onOpenImage}
              large={lead}
            />
            {story.youtubeId && (
              <p className="mt-2 text-xs tracking-wide text-muted uppercase">Video on the brief</p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

{videoOpen && (
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="video-title"
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
    onClick={() => setVideoOpen(false)}
  >
    <button
      type="button"
      className="absolute top-4 right-4 inline-flex min-h-11 items-center bg-white/10 px-3 text-sm text-white/90 hover:bg-white/20 transition-colors"
      onClick={() => setVideoOpen(false)}
      aria-label="Close video"
    >
      <X className="size-5" aria-hidden />
    </button>
    <div className="w-full max-w-4xl aspect-video">
      <iframe
        ref={videoRef}
        className="h-full w-full rounded-lg"
        src={`https://www.youtube-nocookie.com/embed/${story.youtubeId}?autoplay=1&mute=1&rel=0`}
        title={`Video: ${story.title}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  </div>
)}
