import { Redis } from "@upstash/redis";

/**
 * Target-line alerts ("limit orders" for betting).
 * Users set a target line for a game/market; when the live line hits it,
 * they get a web push notification.
 */

export type LineAlert = {
  id: string;
  game: string; // normalized game key
  gameLabel: string; // display label
  market: "spread" | "total";
  side: string; // e.g. "Chiefs -3" or "Over 47.5"
  target: number; // the line value to hit
  direction: "at-or-better"; // line reaches target or better for the user
  created_at: string;
  triggered_at: string | null;
};

function getRedis(): Redis | null {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const keyFor = (email: string) => `moyline:alerts:${email.toLowerCase()}`;

export async function getAlerts(email: string): Promise<LineAlert[]> {
  const redis = getRedis();
  if (!redis) return [];
  const raw = await redis.get(keyFor(email));
  if (!raw) return [];
  try {
    const alerts = (typeof raw === "string" ? JSON.parse(raw) : raw) as LineAlert[];
    return Array.isArray(alerts) ? alerts : [];
  } catch {
    return [];
  }
}

export async function saveAlerts(email: string, alerts: LineAlert[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(keyFor(email), JSON.stringify(alerts));
}

export async function addAlert(
  email: string,
  alert: Omit<LineAlert, "id" | "created_at" | "triggered_at">
): Promise<LineAlert> {
  const alerts = await getAlerts(email);
  const newAlert: LineAlert = {
    ...alert,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    triggered_at: null,
  };
  alerts.push(newAlert);
  await saveAlerts(email, alerts);
  return newAlert;
}

export async function removeAlert(email: string, id: string): Promise<boolean> {
  const alerts = await getAlerts(email);
  const filtered = alerts.filter((a) => a.id !== id);
  if (filtered.length === alerts.length) return false;
  await saveAlerts(email, filtered);
  return true;
}

export async function markTriggered(email: string, id: string): Promise<void> {
  const alerts = await getAlerts(email);
  const alert = alerts.find((a) => a.id === id);
  if (alert && !alert.triggered_at) {
    alert.triggered_at = new Date().toISOString();
    await saveAlerts(email, alerts);
  }
}

/** Get all alerts across all users (for the checker cron). */
export async function getAllAlerts(): Promise<{ email: string; alerts: LineAlert[] }[]> {
  const redis = getRedis();
  if (!redis) return [];
  const keys = await redis.keys("moyline:alerts:*");
  const out: { email: string; alerts: LineAlert[] }[] = [];
  for (const k of keys) {
    const email = k.replace("moyline:alerts:", "");
    const alerts = await getAlerts(email);
    const pending = alerts.filter((a) => !a.triggered_at);
    if (pending.length > 0) {
      out.push({ email, alerts: pending });
    }
  }
  return out;
}
