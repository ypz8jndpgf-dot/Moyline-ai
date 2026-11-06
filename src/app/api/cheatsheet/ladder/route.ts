import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";
import { buildCheatsheet, buildLadder } from "@/lib/cheatsheet";

export const dynamic = "force-dynamic";
// The sheet build behind this can pull schedules + box scores on the
// first build of the day; cached sheets return instantly after that.
export const maxDuration = 60;

/**
 * Prop Explorer ladder for one Cheatsheet leg (optimization #49):
 * alternate lines for the same player + market with the best cached
 * price per rung and real hit rates at each rung from ESPN game logs.
 * Member-gated exactly like /api/cheatsheet. Cache-only — the ladder
 * never triggers an Odds API pull.
 */
export async function GET(req: Request) {
  const session = await auth();
  const email = session?.user?.email || null;
  if (!email) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const sub = await getSubscription(email);
  if (!(await hasAccess(email, sub))) {
    return NextResponse.json({ error: "Members only" }, { status: 403 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing leg id" }, { status: 400 });
  }
  const sheet = await buildCheatsheet();
  const leg = sheet?.legs.find((l) => l.id === id);
  if (!sheet || !leg) {
    return NextResponse.json({ error: "Leg not on today's sheet" }, { status: 404 });
  }
  const ladder = await buildLadder(leg, sheet.date);
  return NextResponse.json(ladder);
}
