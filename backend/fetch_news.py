#!/usr/bin/env python3
"""Fetch RSS/Atom feeds and write news-data.js for news-dashboard.html. Standard library only."""
import concurrent.futures as cf
import gzip, hashlib, html, json, os, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

# LLM Analysis Configuration
LLM_API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("CLAUDE_API_KEY")
LLM_PROVIDER = "gemini" if os.environ.get("GEMINI_API_KEY") else "claude" if os.environ.get("CLAUDE_API_KEY") else None
ANALYSIS_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "analysis-cache.json")

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "news-data.js")

def gnews(domain, extra=""):
    q = urllib.parse.quote(f"site:{domain} {extra} when:2d".replace("  ", " "))
    return f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"

# (name, tier, direct feed or None, domain, extra search words for the Google News fallback)
SOURCES = [
    ("The Daily Star", 2, "https://www.thedailystar.net/frontpage/rss.xml", "thedailystar.net", ""),
    ("Prothom Alo English", 2, None, "en.prothomalo.com", ""),
    ("Prothom Alo Bangla", 2, "https://www.prothomalo.com/rss", "prothomalo.com", ""),
    ("Bangla Tribune", 2, "https://www.banglatribune.com/rss", "banglatribune.com", ""),
    ("bdnews24", 2, None, "bdnews24.com", ""),
    ("Dhaka Tribune", 2, None, "dhakatribune.com", ""),
    ("New Age", 3, None, "newagebd.net", ""),
    ("The Business Standard", 3, None, "tbsnews.net", ""),
    ("Reuters", 1, None, "reuters.com", "(Bangladesh OR Asia OR China OR India)"),
    ("AP", 1, None, "apnews.com", "(Bangladesh OR Asia OR China OR India)"),
    ("BBC", 1, "https://feeds.bbci.co.uk/news/world/rss.xml", "bbc.com", ""),
    ("Al Jazeera", 1, "https://www.aljazeera.com/xml/rss/all.xml", "aljazeera.com", ""),
    ("DW", 1, "https://rss.dw.com/rdf/rss-en-all", "dw.com", ""),
    ("The Diplomat", 3, "https://thediplomat.com/feed/", "thediplomat.com", ""),
    ("Nikkei Asia", 1, "https://asia.nikkei.com/rss/feed/nar", "asia.nikkei.com", ""),
    ("South China Morning Post", 2, "https://www.scmp.com/rss/91/feed", "scmp.com", ""),
    ("The Hindu", 2, "https://www.thehindu.com/news/international/feeder/default.rss", "thehindu.com", ""),
    ("Dawn", 2, "https://www.dawn.com/feeds/home", "dawn.com", ""),
]

CATEGORIES = {
    "Bangladesh": r"bangladesh\w*|dhaka|chattogram|chittagong|rohingya|cox'?s bazar|sylhet|rajshahi|khulna|bnp|jamaat|awami",
    "Geopolitics": r"diplomac\w*|diplomat(s|ic)?|treaty|alliance|border|sanctions?|military|navy|missiles?|summit|foreign (minister|policy|secretary)|ceasefire|war|nato|quad|brics|indo-pacific",
    "Economy": r"econom\w*|gdp|inflation|trade|tariffs?|exports?|imports?|budget|banks?|imf|world bank|remittances?|garments?|rmg|currency|markets?",
    "Climate": r"climate|carbon|emissions?|warming|floods?|cyclones?|heatwaves?|sea.level|drought|cop\d\d",
    "Tech": r"technology|tech|ai|artificial intelligence|digital|cyber\w*|semiconductors?|chips?|startups?|internet",
    "Health": r"health|dengue|vaccines?|disease|hospitals?|outbreak|virus|pandemic|WHO",
}
LOCAL = {"The Daily Star", "Prothom Alo English", "Prothom Alo Bangla", "Bangla Tribune", "bdnews24", "Dhaka Tribune", "New Age", "The Business Standard"}
FOREIGN = r"world|global|Gaza|Britain|UK|Europe\w*|Africa\w*|Australia\w*|Canada|France|Germany|Korea\w*|Mexico|Brazil|Turkey|Trump|Putin"
PLAYERS = ["Bangladesh", "India", "China", "Pakistan", "Myanmar", "United States", "Russia", "Japan", "European Union",
           "United Nations", "IMF", "World Bank", "ASEAN", "BNP", "Jamaat", "Awami League", "Arakan Army", "Israel",
           "Iran", "Saudi Arabia", "Ukraine", "Nepal", "Sri Lanka", "Afghanistan"]
ALIASES = {"United States": r"United States|U\.S\.|US|Washington", "China": r"China|Chinese|Beijing",
           "India": r"India|Indian|New Delhi", "Bangladesh": r"Bangladesh\w*|Dhaka", "Pakistan": r"Pakistan\w*|Islamabad",
           "Russia": r"Russia\w*|Moscow", "European Union": r"European Union|EU", "United Nations": r"United Nations|UN"}
URGENT = r"breaking|attack|explosion|killed|coup|emergency|earthquake|cyclone|war|clash(es)?|crisis"
STOP = set("the a an and or of to in on for with from at by as is are be its it his her their after over says said new will "
           "amid how why what who has have not no more than into about out up us bangladesh bangladeshi dhaka news live".split())

def has(pattern, text):
    # "WHO" must stay case-sensitive, otherwise every "who" counts as health news
    if "|WHO" in pattern:
        return bool(re.search(rf"\b(?:{pattern[:-4]})\b", text, re.I) or re.search(r"\bWHO\b", text))
    return bool(re.search(rf"\b(?:{pattern})\b", text, re.I))

def clean(s):
    s = html.unescape(s or "")
    s = re.sub(r"<(script|style)\b.*?</\1>", " ", s, flags=re.S | re.I)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()

def parse_date(s):
    if not s:
        return None
    for fn in (parsedate_to_datetime, lambda x: datetime.fromisoformat(x.replace("Z", "+00:00"))):
        try:
            d = fn(s.strip())
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError, IndexError):
            pass
    return None

def local(tag):
    return tag.rsplit("}", 1)[-1]

def parse_feed(data, name, tier, via_google):
    items, now = [], datetime.now(timezone.utc)
    for node in ET.fromstring(data.strip()).iter():
        if local(node.tag) not in ("item", "entry"):
            continue
        f, link, image = {}, "", ""
        for c in node:
            t = local(c.tag)
            if t == "link":
                if c.get("rel") in (None, "alternate"):
                    link = link or (c.get("href") or c.text or "").strip()
            elif t in ("content", "thumbnail", "enclosure") and c.get("url"):
                kind = (c.get("type") or c.get("medium") or "image")
                if "image" in kind:
                    image = image or c.get("url")
            else:
                f.setdefault(t, c.text or "")
        title = clean(f.get("title"))
        raw = f.get("description") or f.get("summary") or f.get("encoded") or f.get("content") or ""
        if not image:
            m = re.search(r'<img[^>]+src=["\'](https?://[^"\']+)', html.unescape(raw))
            image = m.group(1) if m else ""
        summary = clean(raw)
        if via_google:  # Google News descriptions only repeat the headline
            title = re.sub(r"\s+[-|]\s+[^-|]{2,40}$", "", title)
            summary = ""
        date = parse_date(f.get("pubDate") or f.get("published") or f.get("date") or f.get("updated"))
        # no usable date means we cannot say how fresh it is, so leave it out
        if not title or not link.startswith(("http://", "https://")) or not date:
            continue
        date = min(date.astimezone(timezone.utc), now)
        if now - date > timedelta(days=30):
            continue
        if len(summary) > 400:
            summary = summary[:400].rsplit(" ", 1)[0] + "…"
        items.append({"id": hashlib.sha1(link.encode()).hexdigest()[:16], "title": title, "url": link,
                      "summary": summary, "image": image if image.startswith("http") else "",
                      "source": name, "tier": tier, "published": date.isoformat()})
    return sorted(items, key=lambda i: i["published"], reverse=True)[:40]

def download(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (personal RSS reader)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = r.read(5_000_000)
    return gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data

def fetch_source(src):
    name, tier, direct, domain, extra = src
    error, stale = "no items", None
    fresh_after = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    for url, via_google in ((direct, False), (gnews(domain, extra), True)):
        if not url:
            continue
        try:
            items = parse_feed(download(url), name, tier, via_google)
            if items and items[0]["published"] < fresh_after:
                stale, error = items, f"newest item is from {items[0]['published'][:10]}"
            elif items:
                return items, {"name": name, "ok": True, "count": len(items), "via": "Google News" if via_google else "own feed"}
        except Exception as e:  # one bad outlet must not stop the run
            error = f"{type(e).__name__}: {e}"[:150]
    return stale or [], {"name": name, "ok": False, "count": len(stale or []), "error": error}

def words(title):
    return {w for w in re.findall(r"[a-z0-9]+", title.lower()) if len(w) > 2 and w not in STOP}

def same_story(a, b):
    shared = a["_w"] & b["_w"]
    if len(shared) < 3:
        return False
    gap = abs(datetime.fromisoformat(a["published"]) - datetime.fromisoformat(b["published"]))
    return gap <= timedelta(hours=48) and len(shared) / len(a["_w"] | b["_w"]) >= 0.3

def build(items):
    now = datetime.now(timezone.utc)
    items = list({i["id"]: i for i in items}.values())
    for i in items:
        i["_w"] = words(i["title"])
    clusters, index = [], {}
    for i in sorted(items, key=lambda x: (x["tier"], not x["summary"], x["published"])):
        # compare with the lead article only, so unrelated stories do not chain together
        candidates = sorted({n for w in i["_w"] for n in index.get(w, ())})
        for n in candidates:
            if same_story(i, clusters[n][0]):
                clusters[n].append(i)
                break
        else:
            for w in i["_w"]:
                index.setdefault(w, []).append(len(clusters))
            clusters.append([i])
    stories = []
    for c in clusters:
        lead = c[0]
        text = " ".join(x["title"] + " " + x["summary"] for x in c[:1])
        found = [k for k, p in CATEGORIES.items() if has(p, text)]
        abroad = has(FOREIGN, text) or any(re.search(rf"\b(?:{ALIASES.get(p, p)})\b", text) for p in PLAYERS if p != "Bangladesh")
        if "Bangladesh" not in found and lead["source"] in LOCAL and not abroad:
            found.insert(0, "Bangladesh")
        cats = found or ["World"]
        if "Bangladesh" not in cats and "World" not in cats:
            cats.append("World")
        outlets = len({x["source"] for x in c})
        newest = max(x["published"] for x in c)
        age = (now - datetime.fromisoformat(newest)).total_seconds() / 3600
        score = min(outlets, 4) * 2 + (3 if "Bangladesh" in cats else 0) + (2 if "Geopolitics" in cats else 0)
        score += (2 if has(URGENT, lead["title"]) else 0) + (3 if age < 6 else 1 if age < 24 else -4)
        level = "Breaking" if age < 6 and score >= 10 else "High" if age < 36 and score >= 7 else "Medium" if score >= 4 else "Low"
        stories.append({**{k: v for k, v in lead.items() if k != "_w"},
                        "image": next((x["image"] for x in c if x["image"]), ""),
                        "published": newest, "categories": cats, "importance": level, "score": score, "outlets": outlets,
                        "coverage": [{k: x[k] for k in ("source", "tier", "title", "url", "published")} for x in c],
                        "players": [p for p in PLAYERS if re.search(rf"\b(?:{ALIASES.get(p, p)})\b", text)]})
    stories.sort(key=lambda s: (s["score"], s["published"]), reverse=True)
    return stories


def verify_stories(stories):
    """Cross-source verification: compare claims within each story cluster."""
    for story in stories:
        coverage = story.get("coverage", [])
        if len(coverage) < 2:
            story["verification"] = "Unverified"
            continue

        # Extract key claims from each source's title + summary
        claims_by_source = []
        for c in coverage:
            text = (c.get("title", "") + " " + c.get("summary", "")).lower()
            # Extract numbers, proper nouns, key entities as claims
            claims = set(re.findall(r'\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|\d+(?:,\d{3})*(?:\.\d+)?%?)\b', text))
            claims_by_source.append((c["source"], claims))

        # Compare claims across sources
        all_claims = {}
        for source, claims in claims_by_source:
            for claim in claims:
                if claim not in all_claims:
                    all_claims[claim] = set()
                all_claims[claim].add(source)

        # Count claims supported by multiple sources
        multi_source_claims = sum(1 for sources in all_claims.values() if len(sources) >= 2)
        total_unique_claims = len(all_claims)

        if total_unique_claims == 0:
            story["verification"] = "Unverified"
        elif multi_source_claims >= max(2, total_unique_claims * 0.3):
            story["verification"] = "Verified"
        elif multi_source_claims >= 1:
            story["verification"] = "Disputed"
        else:
            story["verification"] = "Unverified"

    return stories


def load_previous():
    try:
        with open(OUT, encoding="utf-8") as f:
            return json.loads(f.read().split("=", 1)[1].rstrip().rstrip(";"))
    except (OSError, ValueError, IndexError):
        return {}


def load_analysis_cache():
    """Load analysis cache from disk."""
    try:
        with open(ANALYSIS_CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError, IndexError):
        return {}


def save_analysis_cache(cache):
    """Save analysis cache to disk."""
    try:
        tmp = ANALYSIS_CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        os.replace(tmp, ANALYSIS_CACHE_FILE)
    except OSError:
        pass


def generate_analysis_prompt(story):
    """Build the analysis prompt for a story."""
    coverage_lines = "\n".join(f"- {c['source']}: {c['title']} ({c['url']})" for c in story["coverage"])
    return f"""Analyse this news story. Search the web first and cite a source for every factual claim.
Give: cause and effect; pros and cons; key players; a 30-day timeline; geopolitical context for Bangladesh; related topics.
Say clearly what is unconfirmed or disputed between outlets.

Headline: {story['title']}
Summary: {story.get('summary', '')}
Source coverage:
{coverage_lines}
"""


def call_llm(prompt):
    """Call LLM API (Gemini or Claude) and return response text."""
    if not LLM_API_KEY or not LLM_PROVIDER:
        return None

    import urllib.request
    import urllib.error

    if LLM_PROVIDER == "gemini":
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={LLM_API_KEY}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 4096}
        }
        headers = {"Content-Type": "application/json"}
    else:  # claude
        url = "https://api.anthropic.com/v1/messages"
        payload = {
            "model": "claude-3-5-haiku-20241022",
            "max_tokens": 4096,
            "temperature": 0.3,
            "messages": [{"role": "user", "content": prompt}]
        }
        headers = {
            "Content-Type": "application/json",
            "x-api-key": LLM_API_KEY,
            "anthropic-version": "2023-06-01"
        }

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=60) as r:
            resp = json.loads(r.read().decode())
        if LLM_PROVIDER == "gemini":
            return resp["candidates"][0]["content"]["parts"][0]["text"]
        else:
            return resp["content"][0]["text"]
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, json.JSONDecodeError) as e:
        print(f"LLM call failed: {e}", file=sys.stderr)
        return None


def enrich_stories_with_analysis(stories):
    """Add AI analysis to stories that don't have it cached."""
    if not LLM_API_KEY:
        return stories

    cache = load_analysis_cache()
    updated = False

    for story in stories:
        sid = story["id"]
        if sid in cache:
            story["analysis"] = cache[sid]
            continue

        # Only analyze Breaking and High importance stories to save API calls
        if story["importance"] not in ("Breaking", "High"):
            continue

        prompt = generate_analysis_prompt(story)
        analysis = call_llm(prompt)
        if analysis:
            cache[sid] = analysis
            story["analysis"] = analysis
            updated = True
            time.sleep(0.5)  # Rate limiting

    if updated:
        save_analysis_cache(cache)

    return stories

def main(attempts=1, wait=300):
    for attempt in range(attempts):
        with cf.ThreadPoolExecutor(8) as pool:
            results = list(pool.map(fetch_source, SOURCES))
        if any(items for items, _ in results) or attempt == attempts - 1:
            break
        time.sleep(wait)  # the network is often not up yet right after the PC wakes
    fresh = [i for items, _ in results for i in items]
    health = [h for _, h in results]
    for h in health:
        print(("OK   " if h["ok"] else "FAIL ") + h["name"] + f"  {h['count']}  {h.get('via') or h.get('error')}")
    if not fresh:
        print("Nothing fetched. Keeping the previous data.")
        return 1
    prev = load_previous()
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    old = [i for i in prev.get("raw", []) if datetime.fromisoformat(i["published"]) > cutoff]
    merged = {i["id"]: i for i in old + fresh}
    raw = sorted(merged.values(), key=lambda i: i["published"], reverse=True)[:20000]
    # older entries are only needed for headlines, so drop their bulk
    recent = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    raw = [i if i["published"] > recent else {**i, "summary": "", "image": ""} for i in raw]
    stories = build([dict(i) for i in raw])
    # Cross-source verification
    stories = verify_stories(stories)
    # Enrich with AI analysis (cached, only for Breaking/High)
    stories = enrich_stories_with_analysis(stories)
    # keep the 50 newest stories per category
    keep, count = set(), {}
    for s in sorted(stories, key=lambda s: s["published"], reverse=True):
        for c in s["categories"]:
            if count.get(c, 0) < 50:
                count[c] = count.get(c, 0) + 1
                keep.add(s["id"])
    data = {"updated": datetime.now(timezone.utc).isoformat(), "health": health,
            "stories": [s for s in stories if s["id"] in keep], "raw": raw}
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("window.NEWS_DATA=" + json.dumps(data, ensure_ascii=False).replace("<", "\\u003c") + ";")
    os.replace(tmp, OUT)
    print(f"Saved {len(data['stories'])} stories.")
    return 0

if __name__ == "__main__":
    scheduled = sys.stdout is None  # pythonw has no console
    if scheduled:
        sys.stdout = sys.stderr = open(os.path.join(HERE, "last-run.log"), "w", encoding="utf-8", buffering=1)
    elif hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    sys.exit(main(attempts=4 if scheduled else 1))
