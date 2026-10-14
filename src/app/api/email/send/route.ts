import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { unsubUrl, isUnsubscribed } from "@/lib/unsub";

export const dynamic = "force-dynamic";

/**
 * Send a transactional/marketing email through Resend (domain sender).
 * Protected by PICKS_UPDATE_SECRET (same bearer as /api/picks/update).
 * POST {to, subject, html} -> {ok, unsubscribed?}
 * Replaces {{UNSUBSCRIBE_URL}} with the recipient's signed one-click link.
 * Refuses to send to unsubscribed addresses.
 */
export async function POST(req: Request) {
  const secret = (process.env.PICKS_UPDATE_SECRET || "").trim();
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { to?: string; subject?: string; html?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const to = (body.to || "").trim().toLowerCase();
  const subject = (body.subject || "").trim();
  const html = body.html || "";
  if (!to.includes("@") || !subject || !html) {
    return NextResponse.json({ error: "to, subject, html required" }, { status: 400 });
  }
  if (await isUnsubscribed(to)) {
    return NextResponse.json({ ok: false, unsubscribed: true });
  }
  const finalHtml = html.replace(/\{\{UNSUBSCRIBE_URL\}\}/g, unsubUrl(to));
  const sent = await sendEmail(to, subject, finalHtml);
  return NextResponse.json({ ok: sent });
}
