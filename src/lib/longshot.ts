/**
 * Longshot Ledger (2026-11-02, suggestion #37): the graded record of the
 * daily Longshot of the Day — one labeled high-variance play at +300 or
 * longer. Kept in its OWN store, deliberately separate from the combined
 * track record: longshots never count in the main record, and the main
 * record never borrows their wins. The 6:30am grader writes entries here
 * (and into the results tracker's Longshot section) after grading.
 * SERVER-ONLY.
 */
import { Redis } from "@upstash/redis";

const LEDGER_KEY = "moyline:longshot:ledger";

export interface LongshotEntry {
  date: string; // YYYY-MM-DD (ET)
  game: string;
  play: string;
  price: string; // e.g. "+450 (DraftKings)"
  result: "Win" | "Loss" | "Push";
  final?: string;
}

function cleanEnv(v: string | undefined): string {
  return (v || "").trim().replace(/^["']+|["']+$/g, "");
}

function getRedis(): Redis | null {
  try {
    const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
    const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
    if (!url || !token) return null;
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

export async function getLongshotEntries(): Promise<LongshotEntry[]> {
  try {
    const redis = getRedis();
    if (!redis) return [];
    const raw = await redis.get<string>(LEDGER_KEY);
    if (!raw) return [];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed as LongshotEntry[];
  } catch {
    return [];
  }
}

/** Upsert by (date, normalized game+play) so grader re-runs are safe. */
export async function addLongshotEntries(incoming: LongshotEntry[]): Promise<number> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis not configured");
  const existing = await getLongshotEntries();
  const key = (e: LongshotEntry) =>
    `${e.date}|${e.game.toLowerCase().trim()}|${e.play.toLowerCase().trim()}`;
  const map = new Map(existing.map((e) => [key(e), e]));
  for (const e of incoming) map.set(key(e), e);
  const all = [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  await redis.set(LEDGER_KEY, JSON.stringify(all));
  return all.length;
}

/** Numeric American odds from a price string like "+450 (DraftKings)". */
export function longshotOdds(price: string): number | null {
  const m = price.match(/([+-]\d{2,4})/);
  return m ? Number(m[1]) : null;
}

export interface LongshotTally {
  played: number;
  wins: number;
  losses: number;
  pushes: number;
  /** Cashed longshots (wins) — the headline chase number. */
  cashed: number;
  biggest: number | null; // best (largest) winning price, e.g. 650 for +650
  units: number; // flat 1u: win pays odds/100, loss −1, push 0
}

export function longshotTally(entries: LongshotEntry[]): LongshotTally {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let biggest: number | null = null;
  let units = 0;
  for (const e of entries) {
    const odds = longshotOdds(e.price);
    if (e.result === "Win") {
      wins++;
      if (odds !== null) {
        units += odds > 0 ? odds / 100 : 100 / Math.abs(odds);
        if (biggest === null || odds > biggest) biggest = odds;
      }
    } else if (e.result === "Loss") {
      losses++;
      units -= 1;
    } else {
      pushes++;
    }
  }
  return {
    played: entries.length,
    wins,
    losses,
    pushes,
    cashed: wins,
    biggest,
    units: Math.round(units * 100) / 100,
  };
}
