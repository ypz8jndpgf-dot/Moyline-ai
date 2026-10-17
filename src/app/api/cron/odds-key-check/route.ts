import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

/**
 * Odds API key health check.
 * Hits the Odds API with the configured key; on 401/403, alerts the admin
 * via web push so the key can be re-pasted before visitors see stale lines.
 * Called by Vercel Cron daily. Also safe to hit manually.
 */
export const dynamic = "force-dynamic";

function cleanEnv(v: string | undefined): string {
  return (v || "").trim().replace(/^["']+|["']+$/g, "");
}

export async function GET() {
  const apiKey = cleanEnv(process.env.ODDS_API_KEY);
  const cronSecret = cleanEnv(process.env.CRON_SECRET);

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "ODDS_API_KEY not set" }, { status: 500 });
  }

  // Minimal request: one sport, to conserve quota.
  const url =
    `https://api.the-odds-api.com/v4/sports/upcoming/odds/?` +
    new URLSearchParams({
      apiKey,
      regions: "us",
      markets: "h2h",
      oddsFormat: "american",
      dateFormat: "iso",
    });

  let status: number;
  try {
    const res = await fetch(url, { cache: "no-store" });
    status = res.status;
  } catch (e) {
    return NextResponse.json({ ok: false, error: "network failure", detail: String(e) }, { status: 502 });
  }

  if (status === 401 || status === 403) {
    // Key is bad — alert the admin via web push.
    try {
      const redisUrl = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
      const redisToken = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
      if (redisUrl && redisToken && cronSecret) {
        const redis = new Redis({ url: redisUrl, token: redisToken });
        // Store the alert state so we don't spam — one alert per key failure.
        const alertKey = "moyline:odds-key-alert";
        const alreadyAlerted = await redis.get(alertKey);
        if (!alreadyAlerted) {
          await redis.set(alertKey, new Date().toISOString(), { ex: 86400 });
          // Fire the push via internal call (best-effort; failures logged not thrown).
          const base = cleanEnv(process.env.NEXTAUTH_URL) || "https://www.moylineai.com";
          await fetch(`${base}/api/push/send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${cronSecret}`,
            },
            body: JSON.stringify({
              title: "⚠️ Odds API key failing",
              body: `Key returned ${status} — re-paste ODDS_API_KEY in Vercel. Lines are serving from cache.`,
              url: "/",
            }),
          }).catch(() => {});
        }
      }
    } catch {
      // Alert delivery is best-effort.
    }
    return NextResponse.json(
      { ok: false, error: `Odds API key rejected (HTTP ${status})`, action: "re-paste ODDS_API_KEY in Vercel" },
      { status: 200 }
    );
  }

  // Key works — clear any prior alert flag.
  try {
    const redisUrl = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
    const redisToken = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
    if (redisUrl && redisToken) {
      const redis = new Redis({ url: redisUrl, token: redisToken });
      await redis.del("moyline:odds-key-alert");
    }
  } catch {
    // Best-effort.
  }

  return NextResponse.json({ ok: true, status });
}
