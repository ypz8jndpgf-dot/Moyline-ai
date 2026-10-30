import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";
import { buildCheatsheet } from "@/lib/cheatsheet";

export const dynamic = "force-dynamic";
// First build of the day pulls schedules + box scores for the whole prop
// board; cached sheets return instantly after that.
export const maxDuration = 60;

/**
 * Cheatsheet data for the Parlay Lab: today's researched props ranked by
 * real hit rates from ESPN game logs. Member-gated like the Lab itself.
 */
export async function GET() {
  const session = await auth();
  const email = session?.user?.email || null;
  if (!email) {
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  }
  const sub = await getSubscription(email);
  if (!(await hasAccess(email, sub))) {
    return NextResponse.json({ error: "Members only" }, { status: 403 });
  }
  const sheet = await buildCheatsheet();
  if (!sheet) {
    return NextResponse.json({ date: null, legs: [], poolSize: 0, covered: 0 });
  }
  return NextResponse.json(sheet);
}
