import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getClvForDate } from "@/lib/clv";

const ADMIN = (process.env.ADMIN_EMAIL || "").toLowerCase();

/**
 * Admin read-out of one ET day's captured closing-proxy (CLV) lines.
 * GET /api/admin/clv?date=YYYY-MM-DD
 *   -> { date, count, entries: { <mergeKey>: ClvEntry } }
 * Date defaults to today in America/New_York. The capture runs inside
 * /api/refresh (see src/lib/clv.ts); this route only reads the hash.
 * Same auth as /api/admin/beta and /api/admin/ask-stats: Bearer
 * PICKS_UPDATE_SECRET or the ADMIN_EMAIL session.
 */
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret && secret === process.env.PICKS_UPDATE_SECRET) return true;
  const session = await auth();
  return !!session?.user?.email && session.user.email.toLowerCase() === ADMIN;
}

function todayInNewYork(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = req.nextUrl.searchParams.get("date");
  let date = todayInNewYork();
  if (raw !== null) {
    // Strict YYYY-MM-DD plus a real calendar date (rejects 2026-13-40).
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw)
      return NextResponse.json({ error: "invalid date; use YYYY-MM-DD" }, { status: 400 });
    date = raw;
  }
  const entries = await getClvForDate(date);
  return NextResponse.json({ date, count: Object.keys(entries).length, entries });
}
