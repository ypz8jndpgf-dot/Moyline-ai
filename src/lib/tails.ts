import { Redis } from "@upstash/redis";

export type Tail = {
  game: string;
  play: string;
  price: string;
  date: string;
  tailedAt: string;
};

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
  return s.replace(/^[\"']+|[\"']+$/g, "");
}

export function tailsRedis(): Redis | null {
  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export const tailKey = (email: string) => `moyline:tails:${email.toLowerCase()}`;

export async function readTails(email: string): Promise<Tail[]> {
  const redis = tailsRedis();
  if (!redis) return [];
  try {
    const raw = await redis.get<string>(tailKey(email));
    if (!raw) return [];
    const arr = (typeof raw === "string" ? JSON.parse(raw) : raw) as Tail[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function writeTails(email: string, tails: Tail[]): Promise<void> {
  const redis = tailsRedis();
  if (!redis) throw new Error("Storage not configured");
  await redis.set(tailKey(email), JSON.stringify(tails));
}
