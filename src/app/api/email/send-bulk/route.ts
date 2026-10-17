import { NextResponse } from "next/server";
import { sendEmail, getMemberEmails } from "@/lib/email";
import { unsubUrl } from "@/lib/unsub";

export const dynamic = "force-dynamic";

/**
 * Send an email to ALL members (beta + subscribers + admin, minus unsubscribed).
 * Protected by PICKS_UPDATE_SECRET (same bearer as /api/email/send).
 * POST {subject, html} -> {ok, sent, total}
 * Replaces {{UNSUBSCRIBE_URL}} per-recipient.
 * Used for the daily brief broadcast.
 */
export async function POST(req: Request) {
  const secret = (process.env.PICKS_UPDATE_SECRET || "").trim();
  const auth = req.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { subject?: string; html?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const subject = (body.subject || "").trim();
  const html = body.html || "";
  if (!subject || !html) {
    return NextResponse.json({ error: "subject, html required" }, { status: 400 });
  }

  const members = await getMemberEmails();
  let sent = 0;
  for (const to of members) {
    const perHtml = html.replace(/\{\{UNSUBSCRIBE_URL\}\}/g, unsubUrl(to));
    try {
      if (await sendEmail(to, subject, perHtml)) sent++;
    } catch {
      /* continue to next recipient */
    }
  }
  return NextResponse.json({ ok: true, sent, total: members.length });
}
