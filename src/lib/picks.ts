import { Redis } from "@upstash/redis";

const FEED_KEY = "moyline:picks:today";

/** Redis list holding the rolling free-picks archive (oldest at head, newest at tail). */
export const ARCHIVE_KEY = "moyline:archive";

export type ArchivePick = {
  date: string; // YYYY-MM-DD (ET) — the graded day
  game: string; // e.g. "Memphis @ Tulane (CFB)"
  play: string; // e.g. "Under 55.5"
  price: string; // e.g. "-108 (DraftKings)"
  result: "win" | "loss" | "push";
  star?: boolean;
  sport?: string; // e.g. "CFB", "NHL" — falls back to league label in game parens
};

export type FeedPick = {
  game: string;
  play: string;
  price: string;
  confidence: number;
  star?: boolean;
  reasoning?: string;
  /** Start time, e.g. "6:00pm ET". Optional. */
  starts?: string;
  /** Detailed 2-4 sentence write-up justifying the pick. Optional. */
  writeup?: string;
  /** Long-form deep dive: matchup, trends, line movement, situational factors, edge. Optional. */
  deep_dive?: string;
  /** Quantified edge in cents, e.g. 30 = ~30c edge vs fair price. Optional. */
  edge_cents?: number;
  /** One-line risk note: what most likely kills this bet (steal #3). Optional. */
  risk?: string;
  /** Market type for ticket construction. Optional. */
  market?: "spread" | "total" | "ml" | "prop";
  /** Raw line for spread/total picks, e.g. "-1.5", "5.5". Optional. */
  line?: string;
  /** ISO timestamp when the pick first appeared on the card. Set by the merge. */
  added_at?: string;
  /** ISO timestamp when the pick was last re-published (e.g. changed line). Set by the merge. */
  updated_at?: string;
};

export type PicksFeed = {
  date: string;
  slot: string;
  /** All contributing editions merged into today's card. */
  editions?: string[];
  updated_at: string;
  picks: FeedPick[];
  /** Ranked daily intel: injuries/lineups/weather that move lines (steal #6). */
  intel?: { headline: string; detail?: string }[];
  /** Notable player props from the brief — eligible legs for the Lab's parlay builder. */
  props?: FeedPick[];
  /** Backpage: conf-3 leans. Separate paywalled tab, admin-only paper trading + grading. */
  backpage?: FeedPick[];
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
  /** Weekend lookaheads (Thu/Fri in-season briefs). Keyed by type so NFL and NCAAB coexist. */
  lookaheads?: {
    teaser?: {
      type: "teaser";
      legs: string[];
      points: number;
      confidence: number;
      reasoning?: string;
      target_date: string;
    } | null;
    spotlight?: {
      type: "spotlight";
      picks: {
        game: string;
        play: string;
        price: string;
        confidence: number;
        reasoning?: string;
        edge_cents?: number;
        market?: string;
        line?: string;
      }[];
      target_date: string;
    } | null;
  };
  /** @deprecated — replaced by `lookaheads` map. */
  lookahead?: unknown;
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
 * Reads the rolling free-picks archive from Redis (newest first).
 * Public data — no auth required. Returns empty array when unavailable.
 */
export async function getArchive(): Promise<ArchivePick[]> {
  try {
    const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
    const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
    if (!url || !token) return [];

    const redis = new Redis({ url, token });
    const raw = await redis.lrange<string>(ARCHIVE_KEY, 0, -1);
    if (!raw || raw.length === 0) return [];

    const picks: ArchivePick[] = [];
    for (const item of raw) {
      try {
        const p = (typeof item === "string" ? JSON.parse(item) : item) as ArchivePick;
        if (p && typeof p.game === "string" && (p.result === "win" || p.result === "loss" || p.result === "push")) {
          picks.push(p);
        }
      } catch {
        // Skip malformed entries.
      }
    }
    // Redis list is oldest-first (rpush appends); reverse for newest-first display.
    return picks.reverse();
  } catch {
    return [];
  }
}

/** Extracts the league label from a game string like "Memphis @ Tulane (CFB)". */
export function sportFromGame(game: string): string {
  const m = game.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].toUpperCase() : "OTHER";
}
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
