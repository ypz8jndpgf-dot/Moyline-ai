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

/**
 * Sport tiers (user direction, 2026-11-02: "suppress lesser sports and
 * more frequent pulls for majors" — and never approach the quota limit).
 * - FULL_SPORTS: everything the board carries, pulled on the full
 *   refreshes (2x daily). Lesser soccer (La Liga, Bundesliga, Ligue 1,
 *   Brazil) was dropped entirely — MLS + EPL + UCL carry soccer.
 * - MAJOR_SPORTS: the big leagues, pulled two extra times a day via
 *   /api/refresh?scope=majors, merged into the snapshot (never replacing
 *   the other sports). NCAAB joined the majors when its season opened.
 * - SPORT_SEASONS keeps out-of-season leagues from burning credits on
 *   empty pulls (MLB in November, WNBA in winter, ...).
 */
const FULL_SPORTS = [
  "americanfootball_nfl",
  "americanfootball_ncaaf",
  "basketball_nba",
  "basketball_ncaab",
  "icehockey_nhl",
  "baseball_mlb",
  "basketball_wnba",
  "soccer_usa_mls",
  "soccer_epl",
  "soccer_uefa_champs_league",
];

const MAJOR_SPORTS = [
  "americanfootball_nfl",
  "americanfootball_ncaaf",
  "basketball_nba",
  "basketball_ncaab",
  "icehockey_nhl",
];

/** ET months (1-12) in which a sport has games worth pulling. */
const SPORT_SEASONS: Record<string, number[]> = {
  americanfootball_nfl: [9, 10, 11, 12, 1, 2],
  americanfootball_ncaaf: [8, 9, 10, 11, 12, 1],
  basketball_nba: [10, 11, 12, 1, 2, 3, 4, 5, 6],
  basketball_ncaab: [11, 12, 1, 2, 3, 4],
  icehockey_nhl: [10, 11, 12, 1, 2, 3, 4, 5, 6],
  baseball_mlb: [3, 4, 5, 6, 7, 8, 9, 10],
  basketball_wnba: [5, 6, 7, 8, 9, 10],
  soccer_usa_mls: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  soccer_epl: [8, 9, 10, 11, 12, 1, 2, 3, 4, 5],
  soccer_uefa_champs_league: [9, 10, 11, 12, 1, 2, 3, 4, 5, 6],
};

function currentETMonth(): number {
  return Number(
    new Date().toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      month: "numeric",
    })
  );
}

function inSeason(sport: string, month = currentETMonth()): boolean {
  const months = SPORT_SEASONS[sport];
  return !months || months.includes(month);
}

const BOOKS = ["draftkings", "fanduel", "betmgm", "caesars"];

// Conservative mode: at 75% of quota used, slash burn rate to the majors
// at 2 books / 2 markets. Hard stop at 99% — serve cache, zero API calls.
// Percentage-based so it adapts to any plan tier (20K, 100K, etc.)
const CONSERVATIVE_SPORTS = MAJOR_SPORTS;
const CONSERVATIVE_BOOKS = ["draftkings", "fanduel"];
const CONSERVATIVE_MARKETS = "h2h,spreads";
export const QUOTA_CONSERVATIVE_PCT = 0.75;
const QUOTA_HARD_STOP_PCT = 0.99;

function getConfig() {
  // Sanitize the key: Vercel dashboard pastes sometimes include whitespace or quotes.
  const rawKey = process.env.ODDS_API_KEY || "";
  const apiKey = rawKey.trim().replace(/^["']+|["']+$/g, "").replace(/\s+/g, "");
  return {
    apiKey,
    // An explicit ODDS_SPORTS env wins as-is; otherwise the tiered
    // default list, season-filtered so off-season leagues cost nothing.
    sports: process.env.ODDS_SPORTS
      ? process.env.ODDS_SPORTS.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : FULL_SPORTS.filter((s) => inSeason(s)),
    ttlMin: Number(process.env.ODDS_CACHE_TTL_MIN || 15),
  };
}

/** Sports for a refresh scope: the full board list, or just the majors. */
export function sportsForScope(scope: "full" | "majors"): string[] {
  const { sports } = getConfig();
  if (scope === "majors") {
    return MAJOR_SPORTS.filter((s) => inSeason(s) && sports.includes(s));
  }
  return sports;
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
const QUOTA_KEY = "moyline:odds:quota";

/**
 * Quota state is shared through Redis (like the snapshot), not just
 * module memory: serverless instances are per-request, so an in-memory
 * quotaUsed leaves cold instances unable to enforce the guard until
 * after their first fetch. Every API response refreshes the stored
 * state; refreshOdds loads it before deciding anything.
 */
interface QuotaState {
  used: number;
  remaining: number;
  at: number;
}

async function saveQuotaState(): Promise<void> {
  if (quotaUsed === null || quotaRemaining === null) return;
  try {
    const redis = getRedis();
    if (!redis) return;
    const state: QuotaState = { used: quotaUsed, remaining: quotaRemaining, at: Date.now() };
    await redis.set(QUOTA_KEY, JSON.stringify(state));
  } catch {
    /* best-effort */
  }
}

async function loadQuotaState(): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    const raw = await redis.get<string>(QUOTA_KEY);
    if (!raw) return;
    const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as QuotaState;
    if (typeof parsed?.used === "number" && typeof parsed?.remaining === "number") {
      quotaUsed = parsed.used;
      quotaRemaining = parsed.remaining;
    }
  } catch {
    /* best-effort */
  }
}

/** Shared quota state for other Odds API consumers (e.g. Cheatsheet). */
export async function getQuotaState(): Promise<{
  used: number;
  remaining: number;
  pct: number;
} | null> {
  if (quotaUsed === null || quotaRemaining === null) await loadQuotaState();
  if (quotaUsed === null || quotaRemaining === null) return null;
  const total = quotaUsed + quotaRemaining;
  return {
    used: quotaUsed,
    remaining: quotaRemaining,
    pct: total > 0 ? quotaUsed / total : 0,
  };
}

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
  scope?: "full" | "majors";
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
  if (remaining !== null) quotaRemaining = remaining;
  if (usedHeader || remaining !== null) void saveQuotaState();
  if (!res.ok) {
    throw new Error(`Odds API ${res.status} for ${sport}`);
  }
  const events = (await res.json()) as OddsEvent[];
  return { events, remaining };
}

export async function refreshOdds(
  force = false,
  scope: "full" | "majors" = "full"
): Promise<RefreshResult> {
  const { apiKey, sports, ttlMin } = getConfig();
  const now = Date.now();

  // Enforce the quota guard from the shared Redis state, so a cold
  // instance that has never fetched still knows where the quota stands.
  await loadQuotaState();

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
  // A majors-scope refresh pulls only the major leagues and MERGES them
  // into the current snapshot; a full refresh replaces the board.
  const conservative = isConservative();
  const sportsToFetch = conservative
    ? CONSERVATIVE_SPORTS.filter((s) => inSeason(s))
    : scope === "majors"
      ? sportsForScope("majors")
      : sports;
  const fetchOpts = conservative
    ? { books: CONSERVATIVE_BOOKS, markets: CONSERVATIVE_MARKETS, daysFrom: "1" }
    : { daysFrom: "1" };

  const allEvents: OddsEvent[] = [];
  const refreshed: string[] = [];
  let lastError: string | undefined;

  for (const sport of sportsToFetch) {
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
    let finalEvents = allEvents;
    if (scope === "majors" && !conservative) {
      // Merge: keep every non-major event from the current snapshot,
      // replace the majors with the fresh pulls.
      const snap = await readOddsSnapshot();
      const base =
        snap?.events || (await readJson<OddsEvent[]>(CACHE_FILE, []));
      const fetchedKeys = new Set(refreshed);
      finalEvents = [
        ...base.filter((e) => !fetchedKeys.has(e.sport_key)),
        ...allEvents,
      ];
    }
    memCache = { fetchedAt: now, events: finalEvents };
    await writeJson(CACHE_FILE, finalEvents);
    await writeOddsSnapshot(now, finalEvents);
    await snapshotOpenings(finalEvents);
    return {
      events: finalEvents,
      fetchedAt: now,
      fromCache: false,
      sportsRefreshed: refreshed,
      quotaRemaining,
      error: lastError,
      conservativeMode: conservative,
      scope,
    };
  }

  return {
    events: await readJson<OddsEvent[]>(CACHE_FILE, []),
    fetchedAt: now,
    fromCache: false,
    sportsRefreshed: refreshed,
    quotaRemaining,
    error: lastError,
    conservativeMode: conservative,
    scope,
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
