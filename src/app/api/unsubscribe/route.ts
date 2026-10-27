import { NextResponse } from "next/server";
import { verifyUnsub, setUnsubscribed, isUnsubscribed, setSnoozed } from "@/lib/unsub";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe: GET /api/unsubscribe?email=...&token=...
 * Verifies the HMAC token, records the opt-out in Redis, and redirects
 * to a confirmation page. The redirect carries email+token so the done
 * page can offer a snooze (pause) instead — same HMAC, no new secret.
 * Also accepts POST with a JSON {email, token} body; with
 * {snoozeDays: 7|30} it pauses briefs instead of unsubscribing.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const token = url.searchParams.get("token") || "";
  if (!email.includes("@") || !verifyUnsub(email, token)) {
    return NextResponse.redirect(new URL("/unsubscribe?error=invalid", req.url));
  }
  await setUnsubscribed(email);
  const done = new URL("/unsubscribe/done", req.url);
  done.searchParams.set("email", email);
  done.searchParams.set("token", token);
  return NextResponse.redirect(done);
}

export async function POST(req: Request) {
  let body: { email?: string; token?: string; snoozeDays?: number } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  const token = body.token || "";
  if (!email.includes("@") || !verifyUnsub(email, token)) {
    return NextResponse.json({ ok: false, error: "invalid link" }, { status: 400 });
  }
  if (body.snoozeDays === 7 || body.snoozeDays === 30) {
    const snoozedUntil = await setSnoozed(email, body.snoozeDays);
    return NextResponse.json({ ok: true, snoozedUntil });
  }
  if (await isUnsubscribed(email)) {
    return NextResponse.json({ ok: true, already: true });
  }
  await setUnsubscribed(email);
  return NextResponse.json({ ok: true });
}
