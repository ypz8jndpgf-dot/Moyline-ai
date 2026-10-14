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
