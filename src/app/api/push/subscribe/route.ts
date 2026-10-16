import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { saveSubscription, getVapidPublicKey } from "@/lib/push";

/**
 * Stores a member's push subscription (member must be signed in).
 * Body: { subscription: { endpoint, keys: { p256dh, auth } } }
 */
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || "";
  if (!email) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const sub = (body as Record<string, unknown>)?.subscription as
    | { endpoint?: unknown; keys?: unknown }
    | undefined;
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const keys = sub?.keys as { p256dh?: unknown; auth?: unknown } | undefined;
  const p256dh = typeof keys?.p256dh === "string" ? keys.p256dh : "";
  const authKey = typeof keys?.auth === "string" ? keys.auth : "";
  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ ok: false, error: "Invalid subscription" }, { status: 400 });
  }

  const ok = await saveSubscription(email, {
    endpoint,
    keys: { p256dh, auth: authKey },
    created_at: new Date().toISOString(),
  });
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Storage unavailable" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** Returns the public VAPID key (safe for client use). */
export async function GET() {
  const key = getVapidPublicKey();
  if (!key) {
    return NextResponse.json({ ok: false, error: "Push not configured" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, publicKey: key });
}
