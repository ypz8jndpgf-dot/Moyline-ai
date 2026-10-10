import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";

/** TEMPORARY diagnostic: tests Upstash Redis connectivity with the saved env vars. */
export async function GET() {
  const rawUrl = process.env.UPSTASH_REDIS_REST_URL || "";
  const rawToken = process.env.UPSTASH_REDIS_REST_TOKEN || "";
  const url = rawUrl.trim().replace(/^["']+|["']+$/g, "");
  const token = rawToken.trim().replace(/^["']+|["']+$/g, "");
  const out: Record<string, unknown> = {
    urlPresent: !!rawUrl,
    tokenPresent: !!rawToken,
    urlHost: (() => { try { return new URL(url).hostname; } catch { return "(unparseable)"; } })(),
    urlHadQuotes: rawUrl !== url,
    tokenHadQuotes: rawToken !== token,
    tokenLength: token.length,
  };
  try {
    const redis = new Redis({ url, token });
    const pong = await redis.ping();
    out.redis = { ok: true, pong };
  } catch (e) {
    out.redis = { ok: false, error: (e as Error).message.slice(0, 200) };
  }
  return NextResponse.json(out);
}
