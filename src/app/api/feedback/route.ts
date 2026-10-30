import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

const ADMIN = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const TOPICS = ["Bug report", "Wrong line", "Feature request", "Other"] as const;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Member feedback / report-an-issue (optimization #24). Public POST from the
 * footer form; the note lands in the admin inbox. A honeypot field ("website")
 * silently absorbs bots. No list, no storage — email only, so nothing new to
 * leak. Signed-in members' account email is attached server-side when the
 * session has one; the optional reply-to field in the body is what a visitor
 * typed, kept separate on purpose.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Honeypot: real users never see or fill this field.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const topic =
    typeof body.topic === "string" && (TOPICS as readonly string[]).includes(body.topic)
      ? body.topic
      : "Other";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length < 3 || message.length > 2000) {
    return NextResponse.json(
      { error: "message must be between 3 and 2000 characters" },
      { status: 400 }
    );
  }
  const replyTo =
    typeof body.email === "string" && body.email.includes("@")
      ? body.email.trim().slice(0, 120)
      : "";

  if (!ADMIN) {
    return NextResponse.json({ error: "feedback unavailable" }, { status: 500 });
  }

  let account = "";
  try {
    const session = await auth();
    account = session?.user?.email || "";
  } catch {
    /* anonymous feedback is fine */
  }

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:14px;line-height:1.6;">
      <h2 style="margin:0 0 12px;">MoyLine AI — member feedback</h2>
      <p style="margin:0 0 6px;"><strong>Topic:</strong> ${esc(topic)}</p>
      ${account ? `<p style="margin:0 0 6px;"><strong>Account:</strong> ${esc(account)}</p>` : ""}
      ${replyTo ? `<p style="margin:0 0 6px;"><strong>Reply-to (as typed):</strong> ${esc(replyTo)}</p>` : ""}
      <p style="margin:12px 0 6px;"><strong>Message:</strong></p>
      <p style="margin:0;white-space:pre-wrap;">${esc(message)}</p>
    </div>`;

  const sent = await sendEmail(ADMIN, `[Feedback] ${topic}`, html);
  if (!sent) {
    return NextResponse.json({ error: "could not send — try again" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
