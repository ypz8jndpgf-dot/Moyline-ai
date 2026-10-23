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
import { Redis } from "@upstash/redis";

const API_BASE = "https://api.the-odds-api.com/v4";

const DEFAULT_SPORTS = [
  "americanfootball_nfl",
  "americanfootball_ncaaf",
  "icehockey_nhl",
  "basketball_nba",
  "baseball_mlb",
  "soccer_usa_mls",
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_germany_bundesliga",
  "soccer_italy_serie_a",
  "soccer_france_ligue_one",
  "soccer_brazil_campeonato",
  "soccer_uefa_champs_league",
];

const BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];

// Conservative mode: when quota drops below 5000 remaining (15K used),
// slash burn rate to protect the rest of the month.
const CONSERVATIVE_SPORTS = [
  "americanfootball_nfl",
  "americanfootball_ncaaf",
  "icehockey_nhl",
  "basketball_nba",
];
const CONSERVATIVE_BOOKS = ["draftkings", "fanduel"];
const CONSERVATIVE_MARKETS = "h2h,spreads";
// Conservative mode: when 75% of quota is used, slash burn rate.
// Hard stop at 99% — serve cache, make zero API calls.
// Percentage-based so it adapts to any plan tier (20K, 100K, etc.)
const QUOTA_CONSERVATIVE_PCT = 0.75;
const QUOTA_HARD_STOP_PCT = 0.99;

function getConfig() {
  // Sanitize the key: Vercel dashboard pastes sometimes include whitespace or quotes.
  const rawKey = process.env.ODDS_API_KEY || "";
  const apiKey = rawKey.trim().replace(/^["']+|["']+$/g, "").replace(/\s+/g, "");
  return {
    apiKey,
    sports: (process.env.ODDS_SPORTS || DEFAULT_SPORTS.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    ttlMin: Number(process.env.ODDS_CACHE_TTL_MIN || 15),
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

// ---------------------------------------------------------------------------
// Durable snapshot in Upstash Redis: serverless instances each have their own
// memory and an ephemeral/read-only filesystem, so the mem/file caches alone
// leave cold instances with an empty board (Ask MoyAI 503s). refreshOdds
// mirrors every successful fetch here; cache-only readers fall back to it.
// ---------------------------------------------------------------------------
const ODDS_CACHE_KEY = "moyline:odds:cache";
const OPENINGS_KEY = "moyline:odds:openings";

function getRedis(): Redis | null {
  try {
    const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
    const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
    if (!url || !token) return null;
    return new Redis({ url, token });
  } catch {
    return null;
  }
}

interface OddsSnapshot {
  fetchedAt: number;
  events: OddsEvent[];
}

async function writeOddsSnapshot(fetchedAt: number, events: OddsEvent[]): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    await redis.set(ODDS_CACHE_KEY, JSON.stringify({ fetchedAt, events }));
  } catch {
    /* best-effort — mem/file caches still serve warm instances */
  }
}

async function readOddsSnapshot(): Promise<OddsSnapshot | null> {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const raw = await redis.get<string>(ODDS_CACHE_KEY);
    if (!raw) return null;
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as OddsSnapshot;
    if (!parsed || !Array.isArray(parsed.events)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function loadOpenings(): Promise<Record<string, OpeningBook>> {
  try {
    const redis = getRedis();
    if (redis) {
      const raw = await redis.get<string>(OPENINGS_KEY);
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, OpeningBook>;
        }
      }
    }
  } catch {
    /* fall through to file */
  }
  return readJson<Record<string, OpeningBook>>(OPENING_FILE, {});
}

async function saveOpenings(openings: Record<string, OpeningBook>): Promise<void> {
  await writeJson(OPENING_FILE, openings);
  try {
    const redis = getRedis();
    if (redis) await redis.set(OPENINGS_KEY, JSON.stringify(openings));
  } catch {
    /* best-effort */
  }
}
let quotaUsed: number | null = null;

export function getQuotaRemaining() {
  return quotaRemaining;
}

export function getQuotaUsed() {
  return quotaUsed;
}

function quotaTotal(): number | null {
  if (quotaRemaining !== null && quotaUsed !== null) {
    return quotaRemaining + quotaUsed;
  }
  return null;
}

function isConservative(): boolean {
  const total = quotaTotal();
  if (total === null || quotaUsed === null) return false;
  return quotaUsed / total >= QUOTA_CONSERVATIVE_PCT;
}

function isHardStop(): boolean {
  const total = quotaTotal();
  if (total === null || quotaUsed === null) return false;
  return quotaUsed / total >= QUOTA_HARD_STOP_PCT;
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
  conservativeMode?: boolean;
}

async function fetchSport(
  sport: string,
  apiKey: string,
  opts?: { books?: string[]; markets?: string; daysFrom?: string }
): Promise<{ events: OddsEvent[]; remaining: number | null }> {
  const url =
    `${API_BASE}/sports/${sport}/odds/?` +
    new URLSearchParams({
      apiKey,
      regions: "us",
      markets: opts?.markets || "h2h,spreads,totals",
      oddsFormat: "american",
      bookmakers: (opts?.books || BOOKS).join(","),
      dateFormat: "iso",
      daysFrom: opts?.daysFrom || "1",
    });
  const res = await fetch(url, { cache: "no-store" });
  const remainingHeader = res.headers.get("x-requests-remaining");
  const usedHeader = res.headers.get("x-requests-used");
  const remaining = remainingHeader ? Number(remainingHeader) : null;
  if (usedHeader) quotaUsed = Number(usedHeader);
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

  if (isHardStop()) {
    const cached = memCache?.events || (await readJson<OddsEvent[]>(CACHE_FILE, []));
    return {
      events: cached,
      fetchedAt: memCache?.fetchedAt || 0,
      fromCache: true,
      sportsRefreshed: [],
      quotaRemaining,
      error: `Quota guard: ${quotaUsed} used — serving cache.`,
    };
  }

  // Conservative mode: burn rate protection at 75% quota used.
  const conservative = isConservative();
  const activeSports = conservative ? CONSERVATIVE_SPORTS : sports;
  const fetchOpts = conservative
    ? { books: CONSERVATIVE_BOOKS, markets: CONSERVATIVE_MARKETS, daysFrom: "1" }
    : { daysFrom: "1" };

  const allEvents: OddsEvent[] = [];
  const refreshed: string[] = [];
  let lastError: string | undefined;

  for (const sport of activeSports) {
    try {
      const { events, remaining } = await fetchSport(sport, apiKey, fetchOpts);
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
    await writeOddsSnapshot(now, allEvents);
    await snapshotOpenings(allEvents);
  }

  return {
    events: allEvents.length > 0 ? allEvents : await readJson<OddsEvent[]>(CACHE_FILE, []),
    fetchedAt: now,
    fromCache: false,
    sportsRefreshed: refreshed,
    quotaRemaining,
    error: lastError,
    conservativeMode: conservative,
  };
}

export async function getOdds(): Promise<RefreshResult> {
  // Cost discipline (user's call, 2026-10-22): page loads and other readers
  // serve the shared Redis snapshot for free while it's under ~20h old, so
  // the only Odds API spend is the scheduled daily refresh (plus a forced
  // /api/refresh). If the snapshot is missing or older than that, fall
  // through to a live fetch — self-healing if a scheduled refresh fails.
  const SNAPSHOT_MAX_AGE_MS = 20 * 60 * 60 * 1000;
  const snap = await readOddsSnapshot();
  if (snap && snap.events.length > 0 && Date.now() - snap.fetchedAt < SNAPSHOT_MAX_AGE_MS) {
    memCache = { fetchedAt: snap.fetchedAt, events: snap.events };
    return {
      events: snap.events,
      fetchedAt: snap.fetchedAt,
      fromCache: true,
      sportsRefreshed: [],
      quotaRemaining,
    };
  }
  return refreshOdds(false);
}

/**
 * Cache-only read: returns whatever's in memory/disk cache without ever
 * hitting the API. For playground features (Builder, Lab) that don't need
 * fresh lines — saves credits and works even when the API is down.
 */
export async function getOddsCached(): Promise<RefreshResult> {
  if (memCache) {
    return {
      events: memCache.events,
      fetchedAt: memCache.fetchedAt,
      fromCache: true,
      sportsRefreshed: [],
      quotaRemaining,
    };
  }
  const snap = await readOddsSnapshot();
  if (snap && snap.events.length > 0) {
    memCache = { fetchedAt: snap.fetchedAt, events: snap.events };
    return {
      events: snap.events,
      fetchedAt: snap.fetchedAt,
      fromCache: true,
      sportsRefreshed: [],
      quotaRemaining,
    };
  }
  const events = await readJson<OddsEvent[]>(CACHE_FILE, []);
  return {
    events,
    fetchedAt: 0,
    fromCache: true,
    sportsRefreshed: [],
    quotaRemaining,
  };
}

// ---------------------------------------------------------------------------
// Opening-line snapshots: first-seen lines per event become the "open"
// ---------------------------------------------------------------------------
export type OpeningBook = Record<
  string,
  Record<string, Record<string, { price: number; point?: number }>>
>;

async function snapshotOpenings(events: OddsEvent[]) {
  const openings = await loadOpenings();
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
  if (changed) await saveOpenings(openings);
}

export async function getOpenings(): Promise<Record<string, OpeningBook>> {
  return loadOpenings();
}
