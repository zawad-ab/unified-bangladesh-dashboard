import { PER_SOURCE_CAP, SOURCES, type SourceDef } from "@/lib/news/sources";
import type {
  Category,
  DeskPayload,
  Importance,
  Story,
  Tier,
  Verification,
} from "@/lib/news/types";

const UA = "Mozilla/5.0 (compatible; PadmaBrief/1.0)";
const MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;
const CACHE_MS = 8 * 60 * 1000;
const FRESH_FLOOR_MS = 45 * 1000;

const STOP = new Set(
  "a an the of to and in on for with as at by from after over into its their his her says said say will has have been was were are is or but not be this that than then about amid per via new after before amid over".split(
    " ",
  ),
);

const SHOCK =
  /\b(killed|killing|dead|deaths|death toll|attack|blast|explosion|bomb|cyclone|earthquake|coup|resigns|resigned|emergency|clashes?|shot|missile|sunk|crash|verdict|extradit|collapse)\b/i;

const GEO =
  /\b(border|militar\w*|diplom\w*|sanction|treaty|war|navy|missile|rohingya|geopolit\w*|summit|election|parliament|yunus|hasina|bnp|awami|jamaat|myanmar|teesta|ganges|strait|tariff|coup|extradit\w*|blockade|ceasefire)\b/i;

const FOCUS =
  /\b(hasina|yunus|awami|bnp|jamaat|rohingya|teesta|ganges|tariff|imf|sanction|treaty|border|ceasefire|coup)\b/i;

const NOISE =
  /\b(marries|married|wedding|bride|tennis|atp\b|wimbledon|wickets?|cricket|batting|innings|slogging|bowler|football|soccer|nba\b|ipl\b|celebrity|box office|horoscope|recipe|red carpet|grand slam|test series|\bodi\b|t20|oscar|album)\b/i;

const PRIORITY =
  /\b(bangladesh|dhaka|chittagong|chattogram|sylhet|khulna|rohingya|cox'?s bazar|myanmar|india|pakistan|china|beijing|delhi|islamabad|nepal|sri lanka|maldives|bhutan|bay of bengal|south asia|kolkata|assam|tripura|teesta|yunus|hasina|awami|bnp|jamaat|afghanistan|kabul|iran|gaza|israel|saudi|middle east)\b/i;

type Draft = {
  title: string;
  summary: string;
  url: string;
  source: string;
  sourceHome: string;
  sourceId: string;
  tier: Tier;
  bangladesh: boolean;
  publishedAt: string | null;
  image: string | null;
  tokens: string[];
};

let memory: { at: number; payload: DeskPayload } | null = null;

export async function buildDesk(fresh: boolean): Promise<DeskPayload> {
  const now = Date.now();
  if (memory) {
    const age = now - memory.at;
    if (!fresh && age < CACHE_MS) return memory.payload;
    if (fresh && age < FRESH_FLOOR_MS) return memory.payload;
  }
  const payload = await aggregate();
  memory = { at: Date.now(), payload };
  return payload;
}

async function aggregate(): Promise<DeskPayload> {
  const settled = await mapPool(SOURCES, 6, pullSource);
  const failedSources: string[] = [];
  const drafts: Draft[] = [];
  for (const row of settled) {
    if (row.failed) failedSources.push(row.name);
    drafts.push(...row.items);
  }

  const deduped = dedupeUrls(drafts);
  const stories = cluster(deduped)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 72);

  const warnings: string[] = [];
  if (stories.length === 0) {
    warnings.push(
      "No wires came back. The last saved desk will stay on this device if you have one.",
    );
  } else if (failedSources.length) {
    warnings.push(`Missed this pull: ${failedSources.join(", ")}.`);
  }

  return {
    stories,
    fetchedAt: new Date().toISOString(),
    sourceCount: SOURCES.length - failedSources.length,
    failedSources,
    warnings,
  };
}

type Pull = { name: string; failed: boolean; items: Draft[] };

async function pullSource(source: SourceDef): Promise<Pull> {
  const batches = await Promise.all(source.feeds.map((feed) => pullFeed(source, feed.url)));
  const items = batches.flat();
  const failed = items.length === 0;
  items.sort((a, b) => time(b.publishedAt) - time(a.publishedAt));
  return { name: source.name, failed, items: items.slice(0, PER_SOURCE_CAP) };
}

async function pullFeed(source: SourceDef, url: string): Promise<Draft[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    if (!res.ok) {
      console.error(`[padma] ${source.name} HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    if (!/<item[\s>]/i.test(xml)) {
      console.error(`[padma] ${source.name} returned no items`);
      return [];
    }
    return parseItems(xml, source);
  } catch (err) {
    console.error(`[padma] ${source.name} failed`, err instanceof Error ? err.message : err);
    return [];
  }
}

function parseItems(xml: string, source: SourceDef): Draft[] {
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  const out: Draft[] = [];
  const seen = new Set<string>();
  for (const raw of chunks) {
    const chunk = raw.split(/<\/item>/i)[0] ?? raw;
    const title = cleanTitle(textify(inner(chunk, ["title"])), source.name);
    const url = firstUrl(inner(chunk, ["link", "guid"])) || attr(chunk, "rdf:about");
    if (!title || isJunkTitle(title) || !url || seen.has(url)) continue;
    if (/^(advert|sponsored)\b/i.test(title)) continue;
    const publishedAt = parseDate(inner(chunk, ["pubDate", "dc:date", "updated", "atom:updated"]));
    if (publishedAt && Date.now() - new Date(publishedAt).getTime() > MAX_AGE_MS) continue;
    const description = textify(inner(chunk, ["description"]));
    const encoded = textify(inner(chunk, ["content:encoded"]));
    const summary = standfirst(
      description.length > 70 ? description : encoded || description,
      title,
    );
    seen.add(url);
    out.push({
      title,
      summary,
      url,
      source: source.name,
      sourceHome: source.home,
      sourceId: source.id,
      tier: source.tier,
      bangladesh: source.bangladesh,
      publishedAt,
      image: mediaUrl(chunk),
      tokens: tokens(title),
    });
    if (out.length >= 20) break;
  }
  return out;
}

function cluster(items: Draft[]): Story[] {
  const ordered = [...items].sort((a, b) => time(b.publishedAt) - time(a.publishedAt));
  const buckets: { tokens: string[]; members: Draft[] }[] = [];
  for (const item of ordered) {
    let best: { index: number; score: number } | null = null;
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i]!;
      const sim = jaccard(item.tokens, bucket.tokens);
      const shared = overlap(item.tokens, bucket.tokens);
      if (sim >= 0.42 || shared >= 3) {
        if (!best || sim > best.score) best = { index: i, score: sim };
      }
    }
    if (best) buckets[best.index]!.members.push(item);
    else buckets.push({ tokens: item.tokens, members: [item] });
  }

  return buckets
    .map((bucket) => {
      const members = [...bucket.members].sort((a, b) => leadRank(b) - leadRank(a));
      const lead = members[0]!;
      const sources = unique(members.map((m) => m.source));
      const outletCount = sources.length;
      const verification: Verification =
        outletCount >= 3 ? "verified" : outletCount === 2 ? "corroborated" : "single";
      const blob = members.map((m) => `${m.title} ${m.summary}`).join(" ");
      const priority = lead.bangladesh || PRIORITY.test(blob);
      const hours = lead.publishedAt
        ? (Date.now() - new Date(lead.publishedAt).getTime()) / 36e5
        : null;
      const importance = rankImportance(
        hours,
        `${lead.title} ${lead.summary}`,
        outletCount,
        priority,
      );
      const related = members
        .filter((m) => m !== lead)
        .filter((m, i, arr) => arr.findIndex((x) => x.source === m.source) === i)
        .slice(0, 5)
        .map((m) => ({ source: m.source, title: m.title, url: m.url, tier: m.tier }));
      const image = lead.image ?? members.find((m) => m.image)?.image ?? null;
      const youtubeId = members.map((m) => youtube(m.url)).find(Boolean) ?? null;
      const videoUrl =
        youtubeId != null
          ? `https://www.youtube.com/watch?v=${youtubeId}`
          : (members.find((m) => /\/videos?\//i.test(m.url))?.url ?? null);
      const words = lead.summary.split(/\s+/).filter(Boolean).length;
      return {
        id: hash(`${normalize(lead.title)}`),
        title: lead.title,
        summary: lead.summary,
        url: lead.url,
        source: lead.source,
        sourceHome: lead.sourceHome,
        tier: lead.tier,
        publishedAt: lead.publishedAt,
        image,
        categories: categorize(blob, lead.bangladesh),
        importance,
        verification,
        outletCount,
        related,
        readingMinutes: Math.min(8, Math.max(2, Math.round(words / 28) || 2)),
        youtubeId,
        videoUrl,
        priority,
      };
    })
    .filter((story) => {
      if (!NOISE.test(`${story.title} ${story.summary}`)) return true;
      return story.categories.some(
        (cat) => cat === "geopolitics" || cat === "climate" || cat === "health",
      );
    });
}

function score(story: Story): number {
  const weight = { breaking: 42, high: 28, medium: 12, low: 0 }[story.importance];
  const hours = story.publishedAt
    ? (Date.now() - new Date(story.publishedAt).getTime()) / 36e5
    : 30;
  const recency = Math.max(0, 26 - hours);
  const bd = story.categories.includes("bangladesh");
  const geo = story.categories.includes("geopolitics");
  return (
    weight +
    recency +
    (4 - story.tier) * 3 +
    Math.min(story.outletCount, 4) * 4 +
    (bd && geo ? 30 : 0) +
    (bd ? 12 : 0) +
    (FOCUS.test(`${story.title} ${story.summary}`) ? 18 : 0) +
    (story.summary ? 4 : 0) +
    (story.priority ? 6 : 0) +
    (story.url.includes("news.google.com") ? 0 : 3)
  );
}

function rankImportance(
  hours: number | null,
  text: string,
  outlets: number,
  priority: boolean,
): Importance {
  const h = hours ?? 36;
  const shock = SHOCK.test(text);
  const geo = GEO.test(text);
  const focus = FOCUS.test(text);
  const soft = NOISE.test(text) && !geo;
  const hard =
    /\b(border|militar\w*|sanction|treaty|rohingya|coup|missile|navy|tariff|extradit\w*|ceasefire|blockade)\b/i.test(
      text,
    );
  const diplomatic =
    /\b(bangladesh|dhaka|chattogram|chittagong)\b/i.test(text) &&
    /\b(pakistan|india|china|myanmar|nepal|sri lanka|maldives|bhutan)\b/i.test(text);
  if (soft) return "low";
  if (h <= 18 && shock && (priority || outlets >= 2) && (geo || focus)) return "breaking";
  if ((focus || diplomatic) && h <= 96) return "high";
  if (h <= 36 && hard && (priority || outlets >= 2)) return "high";
  if (
    h <= 36 &&
    priority &&
    /\b(wage|imf|tariff|default|inflation|remittance|export|treaty|outbreak|cyclone|flood)\b/i.test(
      text,
    )
  ) {
    return "high";
  }
  if (h <= 20 && shock && outlets >= 2 && !priority) return "high";
  if (h <= 48 && (priority || geo)) return "medium";
  return "low";
}

function categorize(text: string, bangladesh: boolean): Category[] {
  const tags = new Set<Category>();
  if (
    /\b(cyclone|flood|climate|emission|heatwave|drought|sundarban|erosion|deforestation|carbon|monsoon|cop\d+)\b/i.test(
      text,
    )
  ) {
    tags.add("climate");
  }
  if (/\b(dengue|hospital|virus|vaccine|health|cholera|disease|doctor|outbreak)\b/i.test(text))
    tags.add("health");
  if (
    /\b(chip|semiconductor|software|cyber|startup|telecom|digital|nvidia|artificial intelligence|\bai\b)\b/i.test(
      text,
    )
  ) {
    tags.add("tech");
  }
  if (
    /\b(economy|trade|inflation|bank|budget|export|garment|rmg|taka|gdp|tariff|imf|remittance|stocks?|loan|port|wages?)\b/i.test(
      text,
    )
  ) {
    tags.add("economy");
  }
  if (GEO.test(text)) tags.add("geopolitics");
  if (bangladesh || /\b(bangladesh|dhaka|chittagong|chattogram|sylhet|padma)\b/i.test(text))
    tags.add("bangladesh");
  if (tags.size === 0) tags.add("world");
  else if (!tags.has("bangladesh") && !tags.has("geopolitics") && !tags.has("economy"))
    tags.add("world");
  return [...tags];
}

function leadRank(item: Draft): number {
  let s = (4 - item.tier) * 3;
  if (!item.url.includes("news.google.com")) s += 6;
  if (item.image) s += 2;
  s += Math.min(item.summary.length, 360) / 80;
  if (item.publishedAt) s += 1;
  return s;
}

function dedupeUrls(items: Draft[]): Draft[] {
  const map = new Map<string, Draft>();
  for (const item of items) {
    const prev = map.get(item.url);
    if (!prev || item.summary.length > prev.summary.length) map.set(item.url, item);
  }
  return [...map.values()];
}

function tokens(title: string): string[] {
  return normalize(title)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function overlap(a: string[], b: string[]): number {
  const B = new Set(b);
  return new Set(a.filter((x) => B.has(x) && x.length >= 5)).size;
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

function time(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function hash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function cleanTitle(title: string, source: string): string {
  let t = title.replace(/\s+/g, " ").trim();
  const sourceBits = source
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  for (let i = 0; i < 2; i++) {
    const cut = Math.max(t.lastIndexOf(" - "), t.lastIndexOf(" | "), t.lastIndexOf(" — "));
    if (cut < 8) break;
    const tail = t.slice(cut + 3).trim();
    if (tail.length > 46 || tail.length < 2) break;
    const low = tail.toLowerCase();
    const looksLikeSource =
      sourceBits.some((bit) => low.includes(bit)) ||
      /\b(news|times|post|star|reuters|bbc|dawn|hindu|tribune|nikkei|diplomat|jazeera|express|english|scmp)\b/i.test(
        low,
      );
    if (!looksLikeSource) break;
    t = t.slice(0, cut).trim();
  }
  return t;
}

function isJunkTitle(title: string): boolean {
  if (title.length < 22) return true;
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length < 4) return true;
  if (/^(top shots|in pictures|photos?|gallery|watch|live updates)\b/i.test(title)) return true;
  if (/\bphoto gallery\b/i.test(title)) return true;
  return false;
}

function standfirst(text: string, title: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const same =
    !clean ||
    clean.toLowerCase() === title.toLowerCase() ||
    clean.toLowerCase().startsWith(title.toLowerCase().slice(0, Math.min(48, title.length)));
  const body = same ? "" : clean;
  if (!body) return "";
  if (body.length <= 340) return body;
  const cut = body.slice(0, 340);
  const last = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (last > 80) return cut.slice(0, last + 1);
  return `${cut.trimEnd()}…`;
}

function inner(chunk: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
    const m = chunk.match(re);
    if (m?.[1]) return unescapeXml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
  }
  return "";
}

function attr(chunk: string, name: string): string {
  const re = new RegExp(`\\b${name}=["']([^"']+)["']`, "i");
  const m = chunk.match(re);
  return m?.[1] ? unescapeXml(m[1]) : "";
}

function firstUrl(value: string): string {
  const m = value.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/&amp;/g, "&") : "";
}

function mediaUrl(chunk: string): string | null {
  const content = chunk.match(/<media:content\b[^>]*\burl=["']([^"']+)["']/i);
  if (content?.[1]) return cleanImg(content[1]);
  const thumb = chunk.match(/<media:thumbnail\b[^>]*\burl=["']([^"']+)["']/i);
  if (thumb?.[1]) return cleanImg(thumb[1]);
  const enc = chunk.match(/<enclosure\b([^>]*)\/?>/i);
  if (enc?.[1]) {
    const url = enc[1].match(/\burl=["']([^"']+)["']/i)?.[1];
    const type = enc[1].match(/\btype=["']([^"']+)["']/i)?.[1] ?? "";
    if (url && (!type || type.startsWith("image") || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url))) {
      return cleanImg(url);
    }
  }
  const img = chunk.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  if (img?.[1]) return cleanImg(img[1]);
  return null;
}

function cleanImg(raw: string): string | null {
  const url = unescapeXml(raw).trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

function textify(value: string): string {
  return unescapeXml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unescapeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => safeCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => safeCode(parseInt(n, 16)));
}

function safeCode(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function youtube(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
  return m?.[1] ?? null;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await fn(items[current]!);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}
