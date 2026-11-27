import type { Tier } from "@/lib/news/types";

export type FeedKind = "rss" | "google";

export type SourceFeed = {
  url: string;
  kind: FeedKind;
};

export type SourceDef = {
  id: string;
  name: string;
  tier: Tier;
  home: string;
  /** Bangladesh outlets stay on the morning desk even without a region keyword. */
  bangladesh: boolean;
  feeds: SourceFeed[];
};

function google(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

export const SOURCES: SourceDef[] = [
  {
    id: "star",
    name: "The Daily Star",
    tier: 2,
    home: "https://www.thedailystar.net/",
    bangladesh: true,
    feeds: [
      { url: google("site:thedailystar.net when:2d"), kind: "google" },
      { url: "https://www.thedailystar.net/business/rss.xml", kind: "rss" },
      { url: "https://www.thedailystar.net/environment/rss.xml", kind: "rss" },
    ],
  },
  {
    id: "alo",
    name: "Prothom Alo",
    tier: 2,
    home: "https://en.prothomalo.com/",
    bangladesh: true,
    feeds: [
      { url: "https://en.prothomalo.com/feed", kind: "rss" },
      { url: google("site:en.prothomalo.com when:2d"), kind: "google" },
    ],
  },
  {
    id: "bdn",
    name: "bdnews24",
    tier: 2,
    home: "https://bdnews24.com/",
    bangladesh: true,
    feeds: [{ url: google("site:bdnews24.com when:2d"), kind: "google" }],
  },
  {
    id: "tribune",
    name: "Dhaka Tribune",
    tier: 2,
    home: "https://www.dhakatribune.com/",
    bangladesh: true,
    feeds: [{ url: google("site:dhakatribune.com when:2d"), kind: "google" }],
  },
  {
    id: "tbs",
    name: "The Business Standard",
    tier: 2,
    home: "https://www.tbsnews.net/",
    bangladesh: true,
    feeds: [{ url: google("site:tbsnews.net when:3d"), kind: "google" }],
  },
  {
    id: "newage",
    name: "New Age",
    tier: 3,
    home: "https://www.newagebd.net/",
    bangladesh: true,
    feeds: [{ url: google("site:newagebd.net when:3d"), kind: "google" }],
  },
  {
    id: "fe",
    name: "The Financial Express",
    tier: 3,
    home: "https://thefinancialexpress.com.bd/",
    bangladesh: true,
    feeds: [{ url: google("site:thefinancialexpress.com.bd when:3d"), kind: "google" }],
  },
  {
    id: "reuters",
    name: "Reuters",
    tier: 1,
    home: "https://www.reuters.com/",
    bangladesh: false,
    feeds: [
      {
        url: google(
          'site:reuters.com (Bangladesh OR Rohingya OR Myanmar OR "South Asia" OR India OR Pakistan) when:4d',
        ),
        kind: "google",
      },
    ],
  },
  {
    id: "ap",
    name: "AP",
    tier: 1,
    home: "https://apnews.com/",
    bangladesh: false,
    feeds: [
      {
        url: google('site:apnews.com (Bangladesh OR Rohingya OR Myanmar OR "South Asia") when:7d'),
        kind: "google",
      },
    ],
  },
  {
    id: "bbc",
    name: "BBC",
    tier: 1,
    home: "https://www.bbc.com/news",
    bangladesh: false,
    feeds: [{ url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml", kind: "rss" }],
  },
  {
    id: "aj",
    name: "Al Jazeera",
    tier: 1,
    home: "https://www.aljazeera.com/",
    bangladesh: false,
    feeds: [{ url: "https://www.aljazeera.com/xml/rss/all.xml", kind: "rss" }],
  },
  {
    id: "dw",
    name: "DW",
    tier: 1,
    home: "https://www.dw.com/",
    bangladesh: false,
    feeds: [{ url: "https://rss.dw.com/xml/rss-en-asia", kind: "rss" }],
  },
  {
    id: "diplomat",
    name: "The Diplomat",
    tier: 2,
    home: "https://thediplomat.com/",
    bangladesh: false,
    feeds: [{ url: "https://thediplomat.com/feed/", kind: "rss" }],
  },
  {
    id: "nikkei",
    name: "Nikkei Asia",
    tier: 2,
    home: "https://asia.nikkei.com/",
    bangladesh: false,
    feeds: [{ url: "https://asia.nikkei.com/rss/feed/nar", kind: "rss" }],
  },
  {
    id: "scmp",
    name: "South China Morning Post",
    tier: 2,
    home: "https://www.scmp.com/",
    bangladesh: false,
    feeds: [{ url: "https://www.scmp.com/rss/91/feed", kind: "rss" }],
  },
  {
    id: "hindu",
    name: "The Hindu",
    tier: 2,
    home: "https://www.thehindu.com/",
    bangladesh: false,
    feeds: [{ url: "https://www.thehindu.com/news/international/feeder/default.rss", kind: "rss" }],
  },
  {
    id: "dawn",
    name: "Dawn",
    tier: 2,
    home: "https://www.dawn.com/",
    bangladesh: false,
    feeds: [{ url: "https://www.dawn.com/feeds/world", kind: "rss" }],
  },
  {
    id: "ht",
    name: "Hindustan Times",
    tier: 2,
    home: "https://www.hindustantimes.com/",
    bangladesh: false,
    feeds: [{ url: "https://www.hindustantimes.com/feeds/rss/world-news/rssfeed.xml", kind: "rss" }],
  },
  {
    id: "cna",
    name: "Channel NewsAsia",
    tier: 2,
    home: "https://www.channelnewsasia.com/",
    bangladesh: false,
    feeds: [
      { url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml", kind: "rss" },
    ],
  },
];

export const PER_SOURCE_CAP = 12;
