import { Redis } from "@upstash/redis";

const FEED_KEY = "moyline:picks:today";

export type FeedPick = {
  game: string;
  play: string;
  price: string;
  confidence: number;
  star?: boolean;
  reasoning?: string;
};

export type PicksFeed = {
  date: string;
  slot: string;
  updated_at: string;
  picks: FeedPick[];
  teaser: {
    legs: string[];
    points: number;
    confidence: number;
    reasoning?: string;
  } | null;
  parlay: {
    legs: string[];
    odds: string;
    book: string;
    confidence: number;
    reasoning?: string;
  } | null;
};

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) {
    s = s.slice(eq + 1).trim();
  }
  return s.replace(/^["']+|["']+$/g, "");
}

/**
 * Reads today's picks feed from Upstash Redis. Returns null when the feed
 * is missing, stale (not from today ET), or unreadable — callers should
 * render an honest "card being prepared" state instead of stale picks.
 */
export async function getPicksFeed(): Promise<PicksFeed | null> {
  try {
    const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
    const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
    if (!url || !token) return null;

    const redis = new Redis({ url, token });
    const raw = await redis.get<string>(FEED_KEY);
    if (!raw) return null;

    const feed = (typeof raw === "string" ? JSON.parse(raw) : raw) as PicksFeed;
    if (!feed || !Array.isArray(feed.picks) || typeof feed.date !== "string") return null;

    // Stale check: feed must be from today (ET).
    const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (feed.date !== todayET) return null;

    return feed;
  } catch {
    return null;
  }
}
