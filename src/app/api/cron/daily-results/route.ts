import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getMemberEmails, sendEmail } from "@/lib/email";
import { unsubUrl } from "@/lib/unsub";
import { briefSignInUrl } from "@/lib/brief-signin";
import { DayResults } from "../../results/update/route";

export const dynamic = "force-dynamic";

const RESULTS_PREFIX = "moyline:results:";

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
  return s.replace(/^[\"']+|[\"']+$/g, "");
}

/**
 * Daily results email (Vercel Cron, ~7:30am ET).
 * Reads yesterday's graded results (posted by the 6:30am grader) and
 * emails every member a short recap. Protected by CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) {
    return NextResponse.json({ error: "Upstash not configured" }, { status: 500 });
  }

  // Yesterday ET.
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  const redis = new Redis({ url, token });
  let results: DayResults | null = null;
  try {
    const raw = await redis.get<string>(RESULTS_PREFIX + yesterday);
    if (raw) results = (typeof raw === "string" ? JSON.parse(raw) : raw) as DayResults;
  } catch {
    results = null;
  }
  if (!results) {
    return NextResponse.json({ ok: false, error: `No graded results for ${yesterday}` });
  }

  const members = await getMemberEmails();
  if (members.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, note: "no members" });
  }

  const { wins, losses, pushes, highlights } = results;
  const headline = `Last night: ${wins}-${losses}${pushes > 0 ? `-${pushes}` : ""}`;
  // On the brief brand system (black/gold table, Arial Black headline).
  // {{SIGNIN_URL}} and {{UNSUB_URL}} are replaced per recipient below — the
  // card button is a one-click sign-in link, so a logged-out member tapping
  // it lands on /picks already signed in instead of at the sign-in wall.
  const html = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0a0a;">
  <tr><td align="center" style="padding:0;">
  <table role="presentation" width="720" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:720px;background-color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
    <tr><td style="background-color:#0a0a0a;border-bottom:3px solid #f5c518;padding:30px 24px 22px 24px;text-align:center;">
      <div style="font-size:32px;font-weight:900;color:#f5c518;letter-spacing:5px;line-height:1;">MOYLINE AI</div>
      <div style="font-size:12px;font-weight:700;color:#ffe9a3;letter-spacing:7px;margin-top:10px;">DAILY RESULTS</div>
      <div style="font-size:13px;color:#999999;margin-top:12px;">${yesterday}</div>
    </td></tr>
    <tr><td style="padding:26px 24px 8px 24px;">
      <h1 style="font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;color:#ffffff;font-size:30px;letter-spacing:1px;margin:0 0 16px;">${headline.toUpperCase()}<span style="color:#f5c518;">.</span></h1>
      ${
        highlights.length > 0
          ? `<ul style="line-height:1.8;color:#d0d0d0;padding-left:20px;margin:0 0 8px;font-size:15px;">${highlights.map((h) => `<li style="margin-bottom:8px;">${h}</li>`).join("")}</ul>`
          : `<p style="color:#999999;font-size:15px;margin:0 0 8px;">Full breakdown in today's 7am brief.</p>`
      }
      <p style="margin:28px 0 8px;text-align:center;"><a href="{{SIGNIN_URL}}" style="background:#f5c518;color:#0a0a0a;font-weight:800;padding:14px 32px;border-radius:999px;text-decoration:none;display:inline-block;font-size:16px;">See today's full card →</a></p>
      <p style="font-size:12px;color:#999999;margin:18px 0 0;text-align:center;"><a href="https://moylineai.com" style="color:#f5c518;text-decoration:none;">moylineai.com</a></p>
      <p style="font-size:11px;color:#666666;margin:10px 0 0;text-align:center;">Analysis for entertainment purposes — not financial advice.</p>
      <p style="font-size:11px;color:#888888;margin:8px 0 20px;text-align:center;"><a href="{{UNSUB_URL}}" style="color:#888888;">Unsubscribe from these emails</a></p>
    </td></tr>
  </table>
  </td></tr>
  </table>`;

  let sent = 0;
  for (const to of members) {
    const perHtml = html
      .replace(/\{\{SIGNIN_URL\}\}/g, await briefSignInUrl(to))
      .replace(/\{\{UNSUB_URL\}\}/g, unsubUrl(to));
    if (await sendEmail(to, `MoyLine AI: ${headline}`, perHtml)) sent++;
  }
  return NextResponse.json({ ok: true, sent, date: yesterday, headline });
}
