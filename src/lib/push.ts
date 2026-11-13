import { Redis } from "@upstash/redis";
import webpush from "web-push";
import { logPush, type PushKind } from "@/lib/push-inbox";

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
 * Every accepted send is logged to the member's push inbox (#74) under
 * `kind` (call sites name their kind; untagged broadcasts log as
 * "announcement").
 */
export async function broadcastPush(payload: {
  title: string;
  body: string;
  url?: string;
  kind?: PushKind | string;
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
        await logPush(email, {
          kind: payload.kind || "announcement",
          title: payload.title,
          body: payload.body,
          url: payload.url || "/picks",
        });
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

/** Why a single-member push did or didn't land. */
export type PushSendOutcome =
  | "sent" // push service accepted the notification
  | "no-subscription" // nothing stored for this member
  | "not-configured" // VAPID keys missing on the server
  | "unavailable" // subscription storage (Redis) unreachable
  | "expired" // endpoint was stale (404/410) — pruned from storage
  | "rejected"; // push service refused the send for another reason

/**
 * Sends a push to one member's stored subscription, reporting exactly
 * what happened. Stale (410/404) subscriptions are removed. When the
 * caller tags the payload with a `kind`, an accepted send is logged to
 * the member's push inbox (#74); untagged sends (e.g. the #63 test
 * push) are never logged.
 */
export async function sendPushDetailed(
  email: string,
  payload: { title: string; body: string; url?: string; kind?: PushKind | string }
): Promise<PushSendOutcome> {
  const outcome = await deliverPush(email, payload);
  if (outcome === "sent" && payload.kind) {
    await logPush(email, {
      kind: payload.kind,
      title: payload.title,
      body: payload.body,
      url: payload.url || "/picks",
    });
  }
  return outcome;
}

async function deliverPush(
  email: string,
  payload: { title: string; body: string; url?: string }
): Promise<PushSendOutcome> {
  if (!vapidConfigured()) return "not-configured";
  if (!getRedis()) return "unavailable";
  const sub = await getSubscription(email);
  if (!sub) return "no-subscription";
  webpush.setVapidDetails(
    "mailto:support@moylineai.com",
    cleanEnv(process.env.VAPID_PUBLIC_KEY),
    cleanEnv(process.env.VAPID_PRIVATE_KEY)
  );
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys } as webpush.PushSubscription,
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url || "/picks",
      })
    );
    return "sent";
  } catch (e: unknown) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) {
      await removeSubscription(email);
      return "expired";
    }
    return "rejected";
  }
}

/**
 * Sends a push to one member's stored subscription.
 * Returns true only when the notification was accepted by the push
 * service. Stale (410/404) subscriptions are removed.
 */
export async function sendPushTo(
  email: string,
  payload: { title: string; body: string; url?: string; kind?: PushKind | string }
): Promise<boolean> {
  return (await sendPushDetailed(email, payload)) === "sent";
}

/** Test-notification copy (Optimization #63). */
export const TEST_PUSH_PAYLOAD = {
  title: "MoyLine AI — alerts are on",
  body: "You'll get ★ plays, steam alerts and settled results here.",
  url: "/picks",
};

/**
 * Sends the test notification to the member's own stored subscription —
 * the exact same delivery path (sendPushDetailed) as real alerts,
 * addressed only to that member. Never a broadcast.
 */
export async function sendTestPush(email: string): Promise<PushSendOutcome> {
  return sendPushDetailed(email, TEST_PUSH_PAYLOAD);
}

/** Max test pushes per member per hour. */
export const TEST_PUSH_LIMIT_PER_HOUR = 3;

/**
 * Per-member rate limit for the test-push endpoint, so it can't be used
 * as a free push relay. Fixed hourly bucket in Redis (same store as the
 * subscriptions): `moyline:push:test:<email>:<hour>`. Returns "ok" when
 * the caller may send, "limited" when over the cap, "unavailable" when
 * the store can't be reached (fail closed — the send would fail anyway).
 */
export async function tryConsumeTestPush(
  email: string
): Promise<"ok" | "limited" | "unavailable"> {
  const redis = getRedis();
  if (!redis) return "unavailable";
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `moyline:push:test:${email.toLowerCase()}:${hour}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 3600);
    }
    return count <= TEST_PUSH_LIMIT_PER_HOUR ? "ok" : "limited";
  } catch {
    return "unavailable";
  }
}
