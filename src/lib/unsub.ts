import { createHmac, timingSafeEqual } from "crypto";
import { Redis } from "@upstash/redis";

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
  return s.replace(/^["']+|["']+$/g, "");
}

function redisClient(): Redis | null {
  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function signingSecret(): string {
  return cleanEnv(process.env.NEXTAUTH_SECRET) || cleanEnv(process.env.CRON_SECRET) || "moyline-unsub-fallback";
}

const UNSUB_PREFIX = "moyline:unsub:";

/** HMAC token binding an email to unsubscribes. URL-safe hex. */
export function signUnsub(email: string): string {
  const e = email.trim().toLowerCase();
  return createHmac("sha256", signingSecret()).update(`unsub:${e}`).digest("hex").slice(0, 32);
}

export function verifyUnsub(email: string, token: string): boolean {
  const expected = signUnsub(email);
  const a = Buffer.from(token || "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unsubUrl(email: string): string {
  const base = (process.env.NEXTAUTH_URL || "https://moyline-ai.vercel.app").replace(/\/$/, "");
  const e = encodeURIComponent(email.trim().toLowerCase());
  return `${base}/api/unsubscribe?email=${e}&token=${signUnsub(email)}`;
}

export async function isUnsubscribed(email: string): Promise<boolean> {
  const redis = redisClient();
  if (!redis) return false;
  try {
    const v = await redis.get(UNSUB_PREFIX + email.trim().toLowerCase());
    return v !== null && v !== undefined;
  } catch {
    return false;
  }
}

export async function setUnsubscribed(email: string): Promise<void> {
  const redis = redisClient();
  if (!redis) return;
  await redis.set(UNSUB_PREFIX + email.trim().toLowerCase(), new Date().toISOString());
}

export async function setResubscribed(email: string): Promise<void> {
  const redis = redisClient();
  if (!redis) return;
  await redis.del(UNSUB_PREFIX + email.trim().toLowerCase());
}

/* ------------------------------------------------------------------ */
/* Snooze (optimization #17, 2026-10-27): a pause instead of a          */
/* permanent unsubscribe. The stored value is the ISO resume date; the  */
/* key expires on its own shortly after. Bulk sends skip snoozed        */
/* members exactly like unsubscribed ones. Choosing a snooze clears     */
/* any permanent unsubscribe — the member picked "pause" over "leave".  */
/* ------------------------------------------------------------------ */

const SNOOZE_PREFIX = "moyline:snooze:";

export async function getSnoozedUntil(email: string): Promise<string | null> {
  const redis = redisClient();
  if (!redis) return null;
  try {
    const v = await redis.get<string>(SNOOZE_PREFIX + email.trim().toLowerCase());
    if (!v) return null;
    const until = typeof v === "string" ? v : String(v);
    return new Date(until).getTime() > Date.now() ? until : null;
  } catch {
    return null;
  }
}

export async function isSnoozed(email: string): Promise<boolean> {
  return (await getSnoozedUntil(email)) !== null;
}

/** Pause briefs for `days`; returns the ISO resume date. Clears any unsubscribe. */
export async function setSnoozed(email: string, days: number): Promise<string> {
  const e = email.trim().toLowerCase();
  const until = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
  const redis = redisClient();
  if (redis) {
    await redis.set(SNOOZE_PREFIX + e, until, { ex: days * 24 * 3600 + 3600 });
  }
  await setResubscribed(e);
  return until;
}

export async function clearSnoozed(email: string): Promise<void> {
  const redis = redisClient();
  if (!redis) return;
  await redis.del(SNOOZE_PREFIX + email.trim().toLowerCase());
}
