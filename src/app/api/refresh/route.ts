import { NextResponse } from "next/server";
import { refreshOdds, getQuotaRemaining } from "@/lib/odds";

export const dynamic = "force-dynamic";

/**
 * Scheduled refresh endpoint (Vercel Cron hits this a few times daily).
 * Protected by CRON_SECRET when set (Vercel sends it as a Bearer token).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    const result = await refreshOdds(true);
    return NextResponse.json({
      ok: true,
      fetchedAt: result.fetchedAt,
      sportsRefreshed: result.sportsRefreshed,
      gameCount: result.events.length,
      quotaRemaining: getQuotaRemaining(),
      error: result.error || null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Refresh failed" },
      { status: 500 }
    );
  }
}
