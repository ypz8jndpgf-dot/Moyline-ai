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

/**
 * Member personalization (steal #5): favorite sports (odds sport keys)
 * and primary sportsbook. Stored per member email in Redis. Used to
 * lead the homepage board with the member's sports and to show a
 * "Your book" price on card picks.
 */
export type MemberPrefs = {
  /** Odds sport keys, e.g. "americanfootball_nfl". Empty = no favorites. */
  sports: string[];
  /** Book label, e.g. "DraftKings". Empty = no primary book. */
  book: string;
};

export const PREF_BOOKS = ["DraftKings", "FanDuel", "BetMGM", "Caesars"];

const keyFor = (email: string) => `moyline:prefs:${email.trim().toLowerCase()}`;

export async function getPrefs(email: string): Promise<MemberPrefs> {
  const empty: MemberPrefs = { sports: [], book: "" };
  const redis = redisClient();
  if (!redis || !email) return empty;
  try {
    const raw = await redis.get<string>(keyFor(email));
    if (!raw) return empty;
    const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<MemberPrefs>;
    return {
      sports: Array.isArray(p.sports) ? p.sports.filter((s) => typeof s === "string") : [],
      book: typeof p.book === "string" ? p.book : "",
    };
  } catch {
    return empty;
  }
}

export async function setPrefs(email: string, prefs: MemberPrefs): Promise<boolean> {
  const redis = redisClient();
  if (!redis || !email) return false;
  await redis.set(keyFor(email), JSON.stringify(prefs));
  return true;
}
