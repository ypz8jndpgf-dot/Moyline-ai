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
  // Optional one-off bet correction (e.g. a mis-parsed price): rewrites the
  // settled bet's odds/pnl so the ledger history ties to the bankroll delta.
  const fixBet = (body as { fixBet?: unknown }).fixBet as
    | { gameContains?: unknown; odds?: unknown; pnl?: unknown }
    | undefined;
  if (fixBet !== undefined) {
    if (
      typeof fixBet?.gameContains !== "string" ||
      typeof fixBet?.odds !== "number" ||
      !isFinite(fixBet.odds) ||
      typeof fixBet?.pnl !== "number" ||
      !isFinite(fixBet.pnl)
    ) {
      return NextResponse.json(
        { ok: false, error: "fixBet needs gameContains (string), odds and pnl (numbers)" },
        { status: 400 }
      );
    }
  }

  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) {
    return NextResponse.json({ ok: false, error: "Upstash not configured" }, { status: 500 });
  }

  try {
    const redis = new Redis({ url, token });
    let fixedBet: { id: string; game: string; odds: number; pnl: number } | null = null;
    if (fixBet) {
      const bets =
        (await redis.get<{ id: string; game: string; odds: number; pnl: number | null }[]>(
          "moyline:paper:bets"
        )) || [];
      const target = bets.find((b) =>
        b.game.toLowerCase().includes((fixBet.gameContains as string).toLowerCase())
      );
      if (!target) {
        return NextResponse.json(
          { ok: false, error: `no paper bet matching "${fixBet.gameContains}"` },
          { status: 404 }
        );
      }
      target.odds = fixBet.odds as number;
      target.pnl = fixBet.pnl as number;
      await redis.set("moyline:paper:bets", bets);
      fixedBet = { id: target.id, game: target.game, odds: target.odds, pnl: target.pnl };
    }
    const newVal = await redis.incrbyfloat("moyline:paper:bankroll", delta);
    return NextResponse.json({
      ok: true,
      delta,
      fixedBet,
      bankroll: Math.round(Number(newVal) * 100) / 100,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "adjust failed" },
      { status: 500 }
    );
  }
}
