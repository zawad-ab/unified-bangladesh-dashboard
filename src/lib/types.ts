export type Tier = 1 | 2 | 3;

export type Importance = "breaking" | "high" | "medium" | "low";

export type Category =
  | "bangladesh"
  | "world"
  | "geopolitics"
  | "economy"
  | "climate"
  | "tech"
  | "health";

export type Verification = "verified" | "corroborated" | "single";

export type RelatedWire = {
  source: string;
  title: string;
  url: string;
  tier: Tier;
};

export type Story = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  sourceHome: string;
  tier: Tier;
  publishedAt: string | null;
  image: string | null;
  categories: Category[];
  importance: Importance;
  verification: Verification;
  outletCount: number;
  related: RelatedWire[];
  readingMinutes: number;
  youtubeId: string | null;
  videoUrl: string | null;
  priority: boolean;
};

export type DeskPayload = {
  stories: Story[];
  fetchedAt: string;
  sourceCount: number;
  failedSources: string[];
  warnings: string[];
};

export type Brief = {
  causeEffect: string;
  pros: string[];
  cons: string[];
  players: { name: string; role: string }[];
  timeline: { label: string; detail: string }[];
  context: string;
  topics: string[];
  note: string;
};

export type BriefResult = { ok: true; brief: Brief } | { ok: false; error: string };

export type ReadResult =
  | { ok: true; text: string; externalOnly: boolean }
  | { ok: false; error: string };

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "bangladesh", label: "Bangladesh" },
  { id: "geopolitics", label: "Geopolitics" },
  { id: "world", label: "World" },
  { id: "economy", label: "Economy" },
  { id: "climate", label: "Climate" },
  { id: "tech", label: "Tech" },
  { id: "health", label: "Health" },
];

export const EMPTY_DESK: DeskPayload = {
  stories: [],
  fetchedAt: new Date(0).toISOString(),
  sourceCount: 0,
  failedSources: [],
  warnings: ["The wires have not been pulled yet."],
};
