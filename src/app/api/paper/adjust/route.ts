import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getBankroll } from "@/lib/paper";

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) {
    s = s.slice(eq + 1).trim();
  }
  return s.replace(/^["']+|["']+$/g, "");
}

/**
 * Admin: adjust the paper bankroll by a delta (e.g. correct a missed reservation).
 * Protected by PICKS_UPDATE_SECRET. Body: { "delta": number, "reason": string }
 */
export async function POST(req: Request) {
  const secret = cleanEnv(process.env.PICKS_UPDATE_SECRET);
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "PICKS_UPDATE_SECRET not configured" },
      { status: 500 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const delta = (body as { delta?: unknown }).delta;
  if (typeof delta !== "number" || !isFinite(delta)) {
    return NextResponse.json({ ok: false, error: "delta must be a number" }, { status: 400 });
  }

  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) {
    return NextResponse.json({ ok: false, error: "Upstash not configured" }, { status: 500 });
  }

  try {
    const redis = new Redis({ url, token });
    const newVal = await redis.incrbyfloat("moyline:paper:bankroll", delta);
    return NextResponse.json({
      ok: true,
      delta,
      bankroll: Math.round(Number(newVal) * 100) / 100,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "adjust failed" },
      { status: 500 }
    );
  }
}
