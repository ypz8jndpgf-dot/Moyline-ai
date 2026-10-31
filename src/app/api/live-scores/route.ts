import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";
import { getLiveScores } from "@/lib/live-scores";

export const dynamic = "force-dynamic";

/**
 * Live scores for today's card picks (member-gated like /picks itself).
 * Payload is just ESPN scoreboard data normalized for client matching.
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
  const games = await getLiveScores();
  return NextResponse.json({ games });
}
