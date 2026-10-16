import { Redis } from "@upstash/redis";
import webpush from "web-push";

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) {
    s = s.slice(eq + 1).trim();
  }
  return s.replace(/^["']+|["']+$/g, "");
}

function getRedis(): Redis | null {
  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** Push subscription stored per member email. */
export type StoredSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  created_at: string;
};

const keyFor = (email: string) => `moyline:push:${email.toLowerCase()}`;

export async function saveSubscription(email: string, sub: StoredSubscription): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  await redis.set(keyFor(email), JSON.stringify(sub));
  return true;
}

export async function removeSubscription(email: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  await redis.del(keyFor(email));
  return true;
}

export async function getSubscription(email: string): Promise<StoredSubscription | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get<string>(keyFor(email));
  if (!raw) return null;
  try {
    const sub = (typeof raw === "string" ? JSON.parse(raw) : raw) as StoredSubscription;
    if (!sub || typeof sub.endpoint !== "string") return null;
    return sub;
  } catch {
    return null;
  }
}

/** All stored subscriptions (for admin broadcast). Scans moyline:push:* keys. */
export async function getAllSubscriptions(): Promise<{ email: string; sub: StoredSubscription }[]> {
  const redis = getRedis();
  if (!redis) return [];
  const keys = await redis.keys("moyline:push:*");
  const out: { email: string; sub: StoredSubscription }[] = [];
  for (const k of keys) {
    const raw = await redis.get<string>(k);
    if (!raw) continue;
    try {
      const sub = (typeof raw === "string" ? JSON.parse(raw) : raw) as StoredSubscription;
      if (sub && typeof sub.endpoint === "string") {
        out.push({ email: k.replace("moyline:push:", ""), sub });
      }
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

function vapidConfigured(): boolean {
  return !!(
    cleanEnv(process.env.VAPID_PUBLIC_KEY) &&
    cleanEnv(process.env.VAPID_PRIVATE_KEY)
  );
}

/**
 * Sends a push notification to every stored subscription.
 * Returns { sent, failed }. Stale (410/404) subscriptions are removed.
 */
export async function broadcastPush(payload: {
  title: string;
  body: string;
  url?: string;
}): Promise<{ sent: number; failed: number; vapid: boolean }> {
  if (!vapidConfigured()) {
    return { sent: 0, failed: 0, vapid: false };
  }
  webpush.setVapidDetails(
    "mailto:support@moylineai.com",
    cleanEnv(process.env.VAPID_PUBLIC_KEY),
    cleanEnv(process.env.VAPID_PRIVATE_KEY)
  );
  const subs = await getAllSubscriptions();
  let sent = 0;
  let failed = 0;
  const data = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/picks",
  });
  await Promise.all(
    subs.map(async ({ email, sub }) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys } as webpush.PushSubscription,
          data
        );
        sent++;
      } catch (e: unknown) {
        const status = (e as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          // Subscription expired — clean it up.
          await removeSubscription(email);
        }
        failed++;
      }
    })
  );
  return { sent, failed, vapid: true };
}

/** The public VAPID key, safe to expose to the client for subscription. */
export function getVapidPublicKey(): string {
  return cleanEnv(process.env.VAPID_PUBLIC_KEY);
}
