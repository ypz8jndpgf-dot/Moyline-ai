/**
 * Tiny JSON-file store for the track record and subscriptions.
 *
 * NOTE for production: serverless filesystems (Vercel) are ephemeral —
 * writes won't persist across instances. For durable production storage,
 * swap these functions for Vercel KV / Postgres / etc. The function
 * signatures are deliberately narrow so the swap is mechanical.
 * Reads of committed seed data (track record) work fine everywhere.
 */
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

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
  result: "Win" | "Loss" | "Push";
  final: string;
}

export interface TrackRecord {
  startDate: string;
  note: string;
  picks: TrackPick[];
  totals: { w: number; l: number; p: number };
}

const TRACK_FILE = "track-record.json";

export async function getTrackRecord(): Promise<TrackRecord> {
  return readJson<TrackRecord>(TRACK_FILE, {
    startDate: "2026-10-01",
    note: "",
    picks: [],
    totals: { w: 0, l: 0, p: 0 },
  });
}

function pickKey(p: Pick<TrackPick, "game" | "play" | "line" | "book">) {
  return [p.game.trim().toLowerCase(), p.play.trim().toLowerCase(), p.line.trim(), p.book.trim().toLowerCase()].join("|");
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
    rec.picks.push({ ...p, id: `${Date.now()}-${added}` });
    added++;
    if (p.result === "Win") rec.totals.w++;
    else if (p.result === "Loss") rec.totals.l++;
    else rec.totals.p++;
  }
  await writeJson(TRACK_FILE, rec);
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
}

const SUBS_FILE = "subscriptions.json";

export async function getSubscription(email: string): Promise<SubRecord> {
  const all = await readJson<Record<string, SubRecord>>(SUBS_FILE, {});
  return all[email.toLowerCase()] || { status: "none", updatedAt: new Date().toISOString() };
}

export async function setSubscription(email: string, rec: SubRecord): Promise<void> {
  const all = await readJson<Record<string, SubRecord>>(SUBS_FILE, {});
  all[email.toLowerCase()] = rec;
  await writeJson(SUBS_FILE, all);
}

/** Owner bypass + active/trialing check. */
export function hasAccess(email: string | null | undefined, sub: SubRecord): boolean {
  const admin = (process.env.ADMIN_EMAIL || "").toLowerCase();
  if (email && admin && email.toLowerCase() === admin) return true;
  return sub.status === "active" || sub.status === "trialing";
}
