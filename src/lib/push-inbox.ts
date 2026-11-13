import { Redis } from "@upstash/redis";

/**
 * "What did I miss" — the per-member push inbox (optimization #74).
 *
 * Every push used to be ephemeral: card-live, new-picks, card-locks,
 * the ★ alarm, daily results, tail alerts — if the member's phone was
 * off or the notification got swiped away, nothing in-app showed it
 * ever happened. The push send paths (lib/push.ts) now log each
 * ACCEPTED send here, and /inbox renders the last few days, so the
 * alarm that matters is never silently lost.
 *
 * Storage follows the alerts/tails pattern: one JSON array per member
 * in Redis, newest first, capped — reads and writes are best-effort
 * and never break a send.
 */

export type PushKind =
  | "card-live"
  | "new-picks"
  | "card-locks"
  | "five-star"
  | "results"
  | "tail"
  | "announcement";

export type PushInboxEntry = {
  kind: PushKind | string;
  title: string;
  body: string;
  url: string;
  at: string; // ISO timestamp of the accepted send
};

export const PUSH_KIND_LABELS: Record<string, string> = {
  "card-live": "📋 Card live",
  "new-picks": "➕ New picks",
  "card-locks": "⏰ Card locks",
  "five-star": "🚨 5-star alarm",
  results: "🏁 Daily results",
  tail: "🎯 Tail alert",
  announcement: "📣 Announcement",
};

const MAX_ENTRIES = 60;

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

const keyFor = (email: string) => `moyline:push-inbox:${email.toLowerCase()}`;

export async function getPushInbox(email: string, days = 7): Promise<PushInboxEntry[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.get<string>(keyFor(email));
    if (!raw) return [];
    const entries = (typeof raw === "string" ? JSON.parse(raw) : raw) as PushInboxEntry[];
    if (!Array.isArray(entries)) return [];
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    return entries.filter((e) => e && typeof e.at === "string" && Date.parse(e.at) >= cutoff);
  } catch {
    return [];
  }
}

/**
 * Records one accepted push for one member. Called by the send paths
 * in lib/push.ts only after the push service accepted the notification
 * — the inbox shows what was actually sent to this member, nothing
 * speculative. Best-effort: any failure is swallowed so a logging
 * hiccup can never break push delivery.
 */
export async function logPush(
  email: string,
  entry: { kind: PushKind | string; title: string; body: string; url?: string }
): Promise<void> {
  const redis = getRedis();
  if (!redis || !email) return;
  try {
    const key = keyFor(email);
    const raw = await redis.get<string>(key);
    let entries: PushInboxEntry[] = [];
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) entries = parsed as PushInboxEntry[];
    }
    entries.unshift({
      kind: entry.kind,
      title: entry.title.slice(0, 160),
      body: entry.body.slice(0, 300),
      url: (entry.url || "/picks").slice(0, 200),
      at: new Date().toISOString(),
    });
    await redis.set(key, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* inbox logging must never break a send */
  }
}
