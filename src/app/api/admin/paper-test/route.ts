import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

/**
 * Diagnostic: test paper trading placement and return detailed errors.
 * Admin only. Remove after debugging.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const results: Record<string, unknown> = {};

  try {
    // 1. Test Redis connection
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    const ping = await redis.ping();
    results.redis_ping = ping;

    // 2. Test parseOdds
    const { parseOdds } = await import("@/lib/paper");
    results.parseOdds_test = parseOdds("-108 (DraftKings)");

    // 3. Test placePaperBets with a dummy pick
    const { placePaperBets } = await import("@/lib/paper");
    const placed = await placePaperBets(
      [{ game: "Test Team A @ Test Team B (TEST)", play: "Under 99.5", price: "-110 (TestBook)" }],
      "2026-10-16",
      "card"
    );
    results.placed = placed;
    results.placed_count = placed.length;

    // 4. Check existing bets
    const { getBets, getBankroll } = await import("@/lib/paper");
    const bets = await getBets();
    results.total_bets = bets.length;
    results.bankroll = await getBankroll();

    return NextResponse.json({ ok: true, ...results });
  } catch (e) {
    results.error = e instanceof Error ? e.message : String(e);
    results.stack = e instanceof Error ? e.stack?.split("\n").slice(0, 5) : undefined;
    return NextResponse.json({ ok: false, ...results }, { status: 200 });
  }
}
