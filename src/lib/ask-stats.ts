import { Redis } from "@upstash/redis";
import type { AskIntent } from "@/lib/ask-engine";

/**
 * Ask MoyAI usage counters — privacy-clean by design.
 *
 * One Redis hash per ET day: moyline:ask:stats:<YYYY-MM-DD>
 *   total          -> questions answered that day
 *   intent:<name>  -> per-category counts (matchup, sport_slate, card,
 *                     record, props, followup, fallback, smalltalk, other)
 *   fallbacks      -> mirror of intent:fallback
 *   followups      -> mirror of intent:followup
 *
 * Counts only: no question text, no user identity, nothing per-user.
 * Writes are fire-and-forget — instrumentation must never fail or delay
 * a chat reply. Keys expire ~45 days after their day's last question.
 */

const KEY_PREFIX = "moyline:ask:stats:";
const TTL_SECONDS = 60 * 60 * 24 * 45;

function getRedis(): Redis | null {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** "YYYY-MM-DD" in America/New_York, `daysAgo` days before today ET. */
function etDateString(daysAgo: number): string {
  const todayET = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  const d = new Date(`${todayET}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** Fire-and-forget: bump today's counters for one answered question. */
export function recordAskStat(intent: AskIntent): void {
  void (async () => {
    try {
      const redis = getRedis();
      if (!redis) return;
      const key = KEY_PREFIX + etDateString(0);
      const pipe = redis.pipeline();
      pipe.hincrby(key, "total", 1);
      pipe.hincrby(key, `intent:${intent}`, 1);
      if (intent === "fallback") pipe.hincrby(key, "fallbacks", 1);
      if (intent === "followup") pipe.hincrby(key, "followups", 1);
      pipe.expire(key, TTL_SECONDS);
      await pipe.exec();
    } catch {
      /* stats are best-effort; never surface an error to the chat */
    }
  })();
}

export type AskDayStats = {
  date: string;
  total: number;
  byIntent: Partial<Record<AskIntent, number>>;
  fallbacks: number;
  followups: number;
};

/** Last `days` ET days of counters, oldest first. */
export async function getAskStats(days = 14): Promise<AskDayStats[]> {
  const redis = getRedis();
  if (!redis) return [];
  const num = (v: unknown): number => {
    const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : 0;
  };
  const out: AskDayStats[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = etDateString(i);
    let raw: Record<string, unknown> | null = null;
    try {
      raw = await redis.hgetall<Record<string, unknown>>(KEY_PREFIX + date);
    } catch {
      raw = null;
    }
    const byIntent: Partial<Record<AskIntent, number>> = {};
    if (raw) {
      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith("intent:")) byIntent[k.slice(7) as AskIntent] = num(v);
      }
    }
    out.push({
      date,
      total: num(raw?.total),
      byIntent,
      fallbacks: num(raw?.fallbacks),
      followups: num(raw?.followups),
    });
  }
  return out;
}
