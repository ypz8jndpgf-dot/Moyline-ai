import { NextResponse } from "next/server";
import { unsubUrl, isUnsubscribed } from "@/lib/unsub";

export const dynamic = "force-dynamic";

/**
 * Mint a signed one-click unsubscribe URL for a recipient.
 * Protected by PICKS_UPDATE_SECRET (same bearer as /api/picks/update).
 * POST {email} -> {url, unsubscribed}
 */
export async function POST(req: Request) {
  const secret = (process.env.PICKS_UPDATE_SECRET || "").trim();
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { email?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  if (!email.includes("@")) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  return NextResponse.json({ url: unsubUrl(email), unsubscribed: await isUnsubscribed(email) });
}
