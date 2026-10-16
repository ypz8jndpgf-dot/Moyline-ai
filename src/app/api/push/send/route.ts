import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { broadcastPush } from "@/lib/push";

/**
 * Admin-only: broadcasts a push notification to all subscribed members.
 * Body: { title: string, body: string, url?: string }
 * Used for "new ★ play" and "steam alert" notifications.
 */
export async function POST(req: Request) {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() || "";
  const admin = (process.env.ADMIN_EMAIL || "").toLowerCase();
  if (!admin || email !== admin) {
    return NextResponse.json({ ok: false, error: "Admin only" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.slice(0, 120) : "";
  const msg = typeof o.body === "string" ? o.body.slice(0, 240) : "";
  const url = typeof o.url === "string" ? o.url.slice(0, 200) : "/picks";
  if (!title || !msg) {
    return NextResponse.json({ ok: false, error: "title and body required" }, { status: 400 });
  }

  const result = await broadcastPush({ title, body: msg, url });
  if (!result.vapid) {
    return NextResponse.json(
      { ok: false, error: "VAPID keys not configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, sent: result.sent, failed: result.failed });
}
