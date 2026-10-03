/**
 * The Odds API client + server-side caching + opening-line snapshots.
 * SERVER-ONLY: imports fs/path. Never import from client components —
 * use ./odds-shared for types and pure helpers.
 *
 * Quota discipline (free tier = 500 req/month):
 * - In-memory cache with TTL (default 30 min) so repeated renders don't refetch.
 * - Last-good snapshot persisted to /data/odds-cache.json for cold starts.
 * - Quota guard: stops refreshing when x-requests-remaining drops below 50.
 * - Opening lines: first time an event is seen, its lines are stored in
 *   /data/opening-lines.json and treated as the opening snapshot forever.
 */
import type { OddsEvent } from "./odds-shared";
import { promises as fs } from "fs";
import path from "path";

const API_BASE = "https://api.the-odds-api.com/v4";

const DEFAULT_SPORTS = [
  "americanfootball_nfl",
  "americanfootball_ncaaf",
  "icehockey_nhl",
  "basketball_nba",
  "baseball_mlb",
  "basketball_wnba",
  "soccer_usa_mls",
  "soccer_epl",
];

const BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];

function getConfig() {
  return {
    apiKey: process.env.ODDS_API_KEY || "",
    sports: (process.env.ODDS_SPORTS || DEFAULT_SPORTS.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    ttlMin: Number(process.env.ODDS_CACHE_TTL_MIN || 30),
  };
}

// ---------------------------------------------------------------------------
// In-memory cache (per server instance)
// ---------------------------------------------------------------------------
interface CacheEntry {
  fetchedAt: number;
  events: OddsEvent[];
}

let memCache: CacheEntry | null = null;
let quotaRemaining: number | null = null;

export function getQuotaRemaining() {
  return quotaRemaining;
}

// ---------------------------------------------------------------------------
// File helpers (best-effort; serverless filesystems are ephemeral —
// documented in README; swap in KV/Postgres for durable production)
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "odds-cache.json");
const OPENING_FILE = path.join(DATA_DIR, "opening-lines.json");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data), "utf8");
  } catch {
    /* ephemeral filesystem — ignore */
  }
}

// ---------------------------------------------------------------------------
// Fetch + refresh
// ---------------------------------------------------------------------------
export interface RefreshResult {
  events: OddsEvent[];
  fetchedAt: number;
  fromCache: boolean;
  sportsRefreshed: string[];
  quotaRemaining: number | null;
  error?: string;
}

async function fetchSport(
  sport: string,
  apiKey: string
): Promise<{ events: OddsEvent[]; remaining: number | null }> {
  const url =
    `${API_BASE}/sports/${sport}/odds/?` +
    new URLSearchParams({
      apiKey,
      regions: "us",
      markets: "h2h,spreads,totals",
      oddsFormat: "american",
      bookmakers: BOOKS.join(","),
      dateFormat: "iso",
    });
  const res = await fetch(url, { cache: "no-store" });
  const remainingHeader = res.headers.get("x-requests-remaining");
  const remaining = remainingHeader ? Number(remainingHeader) : null;
  if (!res.ok) {
    throw new Error(`Odds API ${res.status} for ${sport}`);
  }
  const events = (await res.json()) as OddsEvent[];
  return { events, remaining };
}

export async function refreshOdds(force = false): Promise<RefreshResult> {
  const { apiKey, sports, ttlMin } = getConfig();
  const now = Date.now();

  if (!apiKey) {
    return {
      events: memCache?.events || (await readJson<OddsEvent[]>(CACHE_FILE, [])),
      fetchedAt: memCache?.fetchedAt || 0,
      fromCache: true,
      sportsRefreshed: [],
      quotaRemaining,
      error: "ODDS_API_KEY is not set — showing cached data only.",
    };
  }

  if (!force && memCache && now - memCache.fetchedAt < ttlMin * 60 * 1000) {
    return {
      events: memCache.events,
      fetchedAt: memCache.fetchedAt,
      fromCache: true,
      sportsRefreshed: [],
      quotaRemaining,
    };
  }

  if (quotaRemaining !== null && quotaRemaining < 50) {
    const cached = memCache?.events || (await readJson<OddsEvent[]>(CACHE_FILE, []));
    return {
      events: cached,
      fetchedAt: memCache?.fetchedAt || 0,
      fromCache: true,
      sportsRefreshed: [],
      quotaRemaining,
      error: `Quota guard: only ${quotaRemaining} requests remaining — serving cache.`,
    };
  }

  const allEvents: OddsEvent[] = [];
  const refreshed: string[] = [];
  let lastError: string | undefined;

  for (const sport of sports) {
    try {
      const { events, remaining } = await fetchSport(sport, apiKey);
      if (remaining !== null) quotaRemaining = remaining;
      allEvents.push(...events);
      refreshed.push(sport);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  if (allEvents.length > 0) {
    memCache = { fetchedAt: now, events: allEvents };
    await writeJson(CACHE_FILE, allEvents);
    await snapshotOpenings(allEvents);
  }

  return {
    events: allEvents.length > 0 ? allEvents : await readJson<OddsEvent[]>(CACHE_FILE, []),
    fetchedAt: now,
    fromCache: false,
    sportsRefreshed: refreshed,
    quotaRemaining,
    error: lastError,
  };
}

export async function getOdds(): Promise<RefreshResult> {
  return refreshOdds(false);
}

// ---------------------------------------------------------------------------
// Opening-line snapshots: first-seen lines per event become the "open"
// ---------------------------------------------------------------------------
export type OpeningBook = Record<
  string,
  Record<string, Record<string, { price: number; point?: number }>>
>;

async function snapshotOpenings(events: OddsEvent[]) {
  const openings = await readJson<Record<string, OpeningBook>>(OPENING_FILE, {});
  let changed = false;
  for (const ev of events) {
    if (!openings[ev.id]) {
      const snap: OpeningBook = {};
      for (const bm of ev.bookmakers) {
        snap[bm.key] = {};
        for (const m of bm.markets) {
          snap[bm.key][m.key] = {};
          for (const o of m.outcomes) {
            snap[bm.key][m.key][o.name] = { price: o.price, point: o.point };
          }
        }
      }
      openings[ev.id] = snap;
      changed = true;
    }
  }
  if (changed) await writeJson(OPENING_FILE, openings);
}

export async function getOpenings(): Promise<Record<string, OpeningBook>> {
  return readJson<Record<string, OpeningBook>>(OPENING_FILE, {});
}
