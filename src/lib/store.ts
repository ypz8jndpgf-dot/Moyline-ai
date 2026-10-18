/**
 * Tiny JSON store for the track record and subscriptions.
 *
 * Track record: Redis-backed (Upstash) for durability across serverless
 * instances, with the committed data/track-record.json as seed/fallback.
 * Subscriptions and other small JSON files remain filesystem-based.
 */
import { promises as fs } from "fs";
import path from "path";
import { Redis } from "@upstash/redis";

const DATA_DIR = path.join(process.cwd(), "data");
const TRACK_REDIS_KEY = "moyline:track-record";

function getRedis(): Redis | null {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(name: string, data: unknown): Promise<boolean> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, name), JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Track record
// ---------------------------------------------------------------------------
export interface TrackPick {
  id: string;
  date: string; // YYYY-MM-DD
  edition: string; // e.g. "late", "7am"
  sport: string;
  game: string;
  play: string;
  line: string;
  book: string;
  star?: boolean;
  result: "Win" | "Loss" | "Push" | "Pending";
  final: string;
  conf?: string;
  clv?: string;
}

export interface TrackRecord {
  startDate: string;
  optimizedStartDate?: string;
  note: string;
  picks: TrackPick[];
  totals: { w: number; l: number; p: number };
}

const TRACK_FILE = "track-record.json";

export async function getTrackRecord(): Promise<TrackRecord> {
  const fallback: TrackRecord = {
    startDate: "2026-10-01",
    note: "",
    picks: [],
    totals: { w: 0, l: 0, p: 0 },
  };
  // Redis first (durable), filesystem seed second, empty fallback last.
  try {
    const redis = getRedis();
    if (redis) {
      const raw = await redis.get<string>(TRACK_REDIS_KEY);
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed && Array.isArray(parsed.picks)) return parsed as TrackRecord;
      }
    }
  } catch {
    // fall through to filesystem
  }
  const seeded = await readJson<TrackRecord>(TRACK_FILE, fallback);
  // Backfill Redis from seed so future reads are fast and consistent.
  try {
    const redis = getRedis();
    if (redis && seeded.picks.length > 0) {
      await redis.set(TRACK_REDIS_KEY, JSON.stringify(seeded));
    }
  } catch {
    // non-fatal
  }
  return seeded;
}

async function writeTrackRecord(rec: TrackRecord): Promise<boolean> {
  // Write to Redis (durable); filesystem write is best-effort for local dev.
  try {
    const redis = getRedis();
    if (redis) {
      await redis.set(TRACK_REDIS_KEY, JSON.stringify(rec));
      return true;
    }
  } catch {
    // fall through
  }
  return writeJson(TRACK_FILE, rec);
}

function pickKey(p: Pick<TrackPick, "game" | "play" | "line" | "book">) {
  return [p.game.trim().toLowerCase(), p.play.trim().toLowerCase(), p.line.trim(), p.book.trim().toLowerCase()].join("|");
}

/** Normalize sport labels on ingest so the track record stays clean. */
function normalizeSportInput(rawSport: string | undefined, game: string): string {
  const raw = (rawSport || "").trim();
  const map: Record<string, string> = {
    "UNL": "Soccer", "UNL,": "Soccer", "CNL": "Soccer", "SOCCER": "Soccer",
    "MLB,": "MLB", "MLB, NLCS G1": "MLB", "MLB, ALCS G1": "MLB", "MLB, ALCS G4": "MLB",
    "NLDS": "MLB", "NFL, London": "NFL",
  };
  if (map[raw]) return map[raw];
  const clean = new Set(["NHL","NFL","CFB","MLB","WNBA","MLS","EPL","Bundesliga","La Liga","Ligue 1","UCL","Soccer","NCAAB","NBA"]);
  if (clean.has(raw)) return raw;
  // Derive from game label: strip slot suffixes like [7am], then take parenthetical
  const g = game.replace(/\s*\[\w+\]\s*$/, "").trim();
  const m = g.match(/\(([^)]+)\)\s*$/);
  if (m) {
    const label = m[1].trim();
    if (map[label]) return map[label];
    if (clean.has(label)) return label;
    return label;
  }
  return "Other";
}

/** Strip slot suffixes like [7am], [sat2pm] from game labels. */
function cleanGameLabel(game: string): string {
  return game.replace(/\s*\[\w+\]\s*$/, "").trim();
}

type Pick<T, K extends keyof T> = { [P in K]: T[P] };

/**
 * Append picks with dedupe: an identical pick (same game, play, line, book)
 * counts ONCE. Different lines/prices on the same game are separate picks.
 * Returns { added, skipped }.
 */
export async function appendTrackPicks(
  picks: Omit<TrackPick, "id">[]
): Promise<{ added: number; skipped: number; totals: { w: number; l: number; p: number } }> {
  const rec = await getTrackRecord();
  const seen = new Set(rec.picks.map(pickKey));
  let added = 0;
  let skipped = 0;
  for (const p of picks) {
    const key = pickKey(p);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    rec.picks.push({
      ...p,
      game: cleanGameLabel(p.game),
      sport: normalizeSportInput(p.sport, p.game),
      id: `${Date.now()}-${added}`,
    });
    added++;
    if (p.result === "Win") rec.totals.w++;
    else if (p.result === "Loss") rec.totals.l++;
    else rec.totals.p++;
  }
  await writeTrackRecord(rec);
  return { added, skipped, totals: rec.totals };
}

// ---------------------------------------------------------------------------
// Subscriptions (email -> status). Written by the Stripe webhook.
// ---------------------------------------------------------------------------
export type SubStatus = "active" | "trialing" | "past_due" | "canceled" | "none";

export interface SubRecord {
  status: SubStatus;
  customerId?: string;
  subscriptionId?: string;
  updatedAt: string;
  /** For one-time day/week passes: ISO timestamp when access lapses. */
  expiresAt?: string;
}

const SUBS_FILE = "subscriptions.json";
const SUB_KEY_PREFIX = "moyline:sub:";

function redisConfigured(): boolean {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return !!url && !!token;
}

async function redisClient() {
  const { Redis } = await import("@upstash/redis");
  const clean = (v: string | undefined) => {
    let s = (v || "").trim();
    const eq = s.indexOf("=");
    if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
    return s.replace(/^["']+|["']+$/g, "");
  };
  return new Redis({
    url: clean(process.env.UPSTASH_REDIS_REST_URL),
    token: clean(process.env.UPSTASH_REDIS_REST_TOKEN),
  });
}

const subKey = (email: string) => SUB_KEY_PREFIX + email.toLowerCase();

export async function getSubscription(email: string): Promise<SubRecord> {
  const none: SubRecord = { status: "none", updatedAt: new Date().toISOString() };
  if (redisConfigured()) {
    try {
      const redis = await redisClient();
      const raw = await redis.get<string>(subKey(email));
      if (!raw) return none;
      return (typeof raw === "string" ? JSON.parse(raw) : raw) as SubRecord;
    } catch {
      return none;
    }
  }
  // Local-dev fallback: JSON file.
  const all = await readJson<Record<string, SubRecord>>(SUBS_FILE, {});
  return all[email.toLowerCase()] || none;
}

export async function setSubscription(email: string, rec: SubRecord): Promise<void> {
  if (redisConfigured()) {
    try {
      const redis = await redisClient();
      await redis.set(subKey(email), JSON.stringify(rec));
      return;
    } catch {
      // fall through to file
    }
  }
  const all = await readJson<Record<string, SubRecord>>(SUBS_FILE, {});
  all[email.toLowerCase()] = rec;
  await writeJson(SUBS_FILE, all);
}

/** Owner bypass + beta allowlist (Redis first, env fallback) + active/trialing check + unexpired pass check. */
export async function hasAccess(email: string | null | undefined, sub: SubRecord): Promise<boolean> {
  const admin = (process.env.ADMIN_EMAIL || "").toLowerCase();
  if (email && admin && email.toLowerCase() === admin) return true;
  // Redis beta list (managed via /api/admin/beta) takes priority; env var is the seed/fallback
  let beta: string[] = [];
  const redis = getRedis();
  if (redis) {
    try {
      const members = await redis.smembers("moyline:beta");
      if (members && members.length > 0) beta = members.map((s) => String(s).toLowerCase());
    } catch { /* fall through to env */ }
  }
  if (beta.length === 0) {
    beta = (process.env.BETA_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  if (email && beta.includes(email.toLowerCase())) return true;
  if (sub.status === "active" || sub.status === "trialing") {
    if (sub.expiresAt) {
      return new Date(sub.expiresAt).getTime() > Date.now();
    }
    return true;
  }
  return false;
}

/** Backwards-compat sync wrapper (env var only). Prefer the async hasAccess. */
export function hasAccessSync(email: string | null | undefined, sub: SubRecord): boolean {
  const admin = (process.env.ADMIN_EMAIL || "").toLowerCase();
  if (email && admin && email.toLowerCase() === admin) return true;
  const beta = (process.env.BETA_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (email && beta.includes(email.toLowerCase())) return true;
  if (sub.status === "active" || sub.status === "trialing") {
    if (sub.expiresAt) {
      return new Date(sub.expiresAt).getTime() > Date.now();
    }
    return true;
  }
  return false;
}
