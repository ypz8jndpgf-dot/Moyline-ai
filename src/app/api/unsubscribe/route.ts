import { NextResponse } from "next/server";
import { verifyUnsub, setUnsubscribed, isUnsubscribed } from "@/lib/unsub";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe: GET /api/unsubscribe?email=...&token=...
 * Verifies the HMAC token, records the opt-out in Redis, and redirects
 * to a confirmation page. Also accepts POST with a JSON {email, token} body.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const token = url.searchParams.get("token") || "";
  if (!email.includes("@") || !verifyUnsub(email, token)) {
    return NextResponse.redirect(new URL("/unsubscribe?error=invalid", req.url));
  }
  await setUnsubscribed(email);
  return NextResponse.redirect(new URL("/unsubscribe/done", req.url));
}

export async function POST(req: Request) {
  let body: { email?: string; token?: string } = {};
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
  if (await isUnsubscribed(email)) {
    return NextResponse.json({ ok: true, already: true });
  }
  await setUnsubscribed(email);
  return NextResponse.json({ ok: true });
}
