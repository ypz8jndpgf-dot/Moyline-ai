import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAskStats, type AskDayStats } from "@/lib/ask-stats";

const ADMIN = (process.env.ADMIN_EMAIL || "").toLowerCase();

/**
 * Admin read-out of Ask MoyAI usage counters (counts only — the stats
 * store no question text or user identity; see src/lib/ask-stats.ts).
 * GET /api/admin/ask-stats?days=14 -> { days: [...], totals: {...} }
 * Same auth as /api/admin/beta: Bearer PICKS_UPDATE_SECRET or the
 * ADMIN_EMAIL session.
 */
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret && secret === process.env.PICKS_UPDATE_SECRET) return true;
  const session = await auth();
  return !!session?.user?.email && session.user.email.toLowerCase() === ADMIN;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rawDays = parseInt(req.nextUrl.searchParams.get("days") || "14", 10);
  const days = Number.isFinite(rawDays) ? Math.min(31, Math.max(1, rawDays)) : 14;
  const stats = await getAskStats(days);
  const totals: AskDayStats = { date: "total", total: 0, byIntent: {}, fallbacks: 0, followups: 0 };
  for (const d of stats) {
    totals.total += d.total;
    totals.fallbacks += d.fallbacks;
    totals.followups += d.followups;
    for (const [k, v] of Object.entries(d.byIntent)) {
      const key = k as keyof AskDayStats["byIntent"];
      totals.byIntent[key] = (totals.byIntent[key] || 0) + (v || 0);
    }
  }
  return NextResponse.json({ days: stats, totals });
}
