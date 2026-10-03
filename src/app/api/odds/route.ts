import { NextResponse } from "next/server";
import { getOdds, getOpenings, getQuotaRemaining } from "@/lib/odds";
import { buildBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

/** Public odds board data (opening vs current, deltas, steam, best prices). */
export async function GET() {
  try {
    const [oddsResult, openings] = await Promise.all([getOdds(), getOpenings()]);
    const { games, movers, sports } = buildBoard(oddsResult.events, openings);
    return NextResponse.json({
      games,
      movers,
      sports,
      fetchedAt: oddsResult.fetchedAt,
      fromCache: oddsResult.fromCache,
      quotaRemaining: getQuotaRemaining(),
      error: oddsResult.error || null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load odds" },
      { status: 500 }
    );
  }
}
