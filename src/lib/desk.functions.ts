import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildDesk } from "@/lib/news/build-desk";
import type { Brief, BriefResult, ReadResult } from "@/lib/news/types";

const briefCache = new Map<string, Brief>();
const briefPending = new Map<string, Promise<BriefResult>>();
const briefHits: number[] = [];

const BriefInput = z.object({
  id: z.string().min(4).max(80),
  title: z.string().min(8).max(400),
  summary: z.string().max(800),
  source: z.string().min(2).max(80),
  related: z.array(z.string().max(320)).max(6),
});

const ReadInput = z.object({
  url: z.string().url().max(2000),
});

export const getDesk = createServerFn({ method: "GET" }).handler(async () => buildDesk(false));

export const refreshDesk = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(async () => buildDesk(true));

export const writeBrief = createServerFn({ method: "POST" })
  .validator((input: unknown) => BriefInput.parse(input))
  .handler(async ({ data }): Promise<BriefResult> => {
    const cached = briefCache.get(data.id);
    if (cached) return { ok: true, brief: cached };
    const pending = briefPending.get(data.id);
    if (pending) return pending;
    const job = composeBrief(data).finally(() => briefPending.delete(data.id));
    briefPending.set(data.id, job);
    return job;
  });

export const readStory = createServerFn({ method: "POST" })
  .validator((input: unknown) => ReadInput.parse(input))
  .handler(async ({ data }): Promise<ReadResult> => {
    const url = safeArticleUrl(data.url);
    if (!url) return { ok: false, error: "That link is not a public article." };
    if (url.hostname.endsWith("news.google.com")) {
      return { ok: true, text: "", externalOnly: true };
    }
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PadmaBrief/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });
      if (!res.ok) return { ok: true, text: "", externalOnly: true };
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes("html") && !type.includes("xml") && type) {
        return { ok: true, text: "", externalOnly: true };
      }
      const html = (await res.text()).slice(0, 800_000);
      const text = extractExcerpt(html);
      if (text.length < 140) return { ok: true, text: "", externalOnly: true };
      return { ok: true, text, externalOnly: false };
    } catch (err) {
      console.error("[padma] read failed", err instanceof Error ? err.message : err);
      return { ok: true, text: "", externalOnly: true };
    }
  });

async function composeBrief(data: z.infer<typeof BriefInput>): Promise<BriefResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return { ok: false, error: "Written briefs are unavailable right now." };
  if (!allowBrief()) {
    return { ok: false, error: "The desk has written enough briefs for the moment. Try again shortly." };
  }
  const related = data.related.length ? data.related.map((line) => `- ${line}`).join("\n") : "- No second outlet in this cluster.";
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        model: "grok-4.5",
        temperature: 0.2,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are the analysis editor at Padma Brief, a Bangladesh-focused geopolitics desk. Use only the wires supplied. Do not invent figures, dates, quotes, casualties, or motives. If the copy is thin, say what it does not establish. Short sentences. No 'delve', 'landscape', 'crucial', 'underscore', 'tapestry', or 'it's important to note'.",
          },
          {
            role: "user",
            content: `Story: ${data.title}
Outlet: ${data.source}
Standfirst: ${data.summary}
Also filed:
${related}

Return JSON with keys:
causeEffect (string, 2 sentences),
pros (array of 2 short strings),
cons (array of 2 short strings),
players (array of {name, role}, only people or institutions named or clearly implied, max 4),
timeline (array of {label, detail}; only events the wires date or sequence; if none, one item labeled "This filing"),
context (string, 2-3 sentences on why this matters for Bangladesh or South Asia; if the link is weak, say so),
topics (array of 3 short labels),
note (one sentence on source limits).
JSON only.`,
          },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[padma] brief failed", res.status, detail.slice(0, 180));
      if (
        res.status === 401 ||
        res.status === 403 ||
        /spending-limit|run out of credits|subscription/i.test(detail)
      ) {
        return {
          ok: false,
          error: "Written briefs are paused until desk credits are restored.",
        };
      }
      return { ok: false, error: "The brief could not be written." };
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? "";
    const brief = asBrief(text);
    if (!brief) return { ok: false, error: "The brief came back unreadable." };
    briefCache.set(data.id, brief);
    return { ok: true, brief };
  } catch (err) {
    console.error("[padma] brief error", err instanceof Error ? err.message : err);
    return { ok: false, error: "The brief could not be written." };
  }
}

function allowBrief(): boolean {
  const now = Date.now();
  while (briefHits.length && now - briefHits[0]! > 10 * 60_000) briefHits.shift();
  if (briefHits.length >= 24) return false;
  briefHits.push(now);
  return true;
}

function asBrief(text: string): Brief | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const causeEffect = clip(str(v.causeEffect), 700);
  const context = clip(str(v.context), 800);
  if (!causeEffect || !context) return null;
  const players: Brief["players"] = [];
  if (Array.isArray(v.players)) {
    for (const item of v.players) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const name = clip(str(row.name), 80);
      if (!name) continue;
      players.push({ name, role: clip(str(row.role), 140) || "Named in the wires" });
      if (players.length === 4) break;
    }
  }
  const timeline: Brief["timeline"] = [];
  if (Array.isArray(v.timeline)) {
    for (const item of v.timeline) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const label = clip(str(row.label), 60);
      const detail = clip(str(row.detail), 220);
      if (!label || !detail) continue;
      timeline.push({ label, detail });
      if (timeline.length === 5) break;
    }
  }
  return {
    causeEffect,
    pros: strings(v.pros),
    cons: strings(v.cons),
    players,
    timeline: timeline.length ? timeline : [{ label: "This filing", detail: causeEffect }],
    context,
    topics: strings(v.topics),
    note: clip(str(v.note), 280),
  };
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const line = clip(str(item), 180);
    if (line) out.push(line);
    if (out.length === 4) break;
  }
  return out;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function safeArticleUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (isPrivateIp(host)) return null;
  return url;
}

function isPrivateIp(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function extractExcerpt(html: string): string {
  const fromLd = excerptFromJsonLd(html);
  if (fromLd.length >= 140) return clipBody(fromLd);
  const fromArticle = paragraphsFrom(scope(html, "article"));
  const paragraphs = fromArticle.length ? fromArticle : paragraphsFrom(scope(html, "main"));
  const chosen = paragraphs.length ? paragraphs : paragraphsFrom(html);
  return clipBody(chosen.join("\n\n"));
}

function clipBody(body: string): string {
  if (body.length <= 1500) return body;
  const cut = body.slice(0, 1500);
  const last = cut.lastIndexOf(". ");
  return last > 400 ? cut.slice(0, last + 1) : `${cut.trimEnd()}…`;
}

function excerptFromJsonLd(html: string): string {
  const bodies: string[] = [];
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const raw = (match[1] ?? "").replace(/^\s*<!--|-->\s*$/g, "").trim();
    if (!raw) continue;
    try {
      collectArticleBodies(JSON.parse(raw) as unknown, bodies);
    } catch {
      continue;
    }
  }
  const best = bodies.sort((a, b) => b.length - a.length)[0] ?? "";
  return best
    .replace(/\s+/g, " ")
    .replace(/\s+Also Read:.*$/i, "")
    .replace(/\s+Read more:.*$/i, "")
    .replace(/\s+\S[^|]{0,80}\|\s+[^.]{0,140}?storyline\s+\d+\s*$/i, "")
    .replace(/\s+storyline\s+\d+\s*$/i, "")
    .trim();
}

function collectArticleBodies(data: unknown, out: string[]): void {
  if (!data) return;
  if (Array.isArray(data)) {
    for (const item of data) collectArticleBodies(item, out);
    return;
  }
  if (typeof data !== "object") return;
  const row = data as Record<string, unknown>;
  const type = row["@type"];
  const types = Array.isArray(type) ? type : [type];
  const body = row.articleBody;
  if (
    typeof body === "string" &&
    body.length > 140 &&
    types.some((item) => typeof item === "string" && /article/i.test(item))
  ) {
    out.push(body);
  }
  if (row["@graph"]) collectArticleBodies(row["@graph"], out);
}

function scope(html: string, tag: string): string {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "i"));
  return match?.[0] ?? "";
}

const EXCERPT_JUNK =
  /subscri|premium|unlock|sign in|log in|cookie|newsletter|all rights reserved|advertisement|related (articles|stories)|share this|follow us|download the app|privacy policy|writes to you|copyright|terms of use|sponsored|recommended for you|also read|trending now|app store|play store|books of the week|new titles and features/i;

function paragraphsFrom(html: string): string[] {
  if (!html) return [];
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ");
  const paragraphs: string[] = [];
  for (const match of stripped.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = textify(match[1] ?? "");
    if (text.length < 80 || !text.includes(".")) continue;
    if (EXCERPT_JUNK.test(text)) continue;
    paragraphs.push(text);
    if (paragraphs.length === 6) break;
  }
  return paragraphs;
}

function textify(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => fromCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => fromCode(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
}

function fromCode(code: number): string {
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return "";
  return String.fromCodePoint(code);
}
