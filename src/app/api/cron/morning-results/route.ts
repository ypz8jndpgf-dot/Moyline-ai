import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getMemberEmails, sendEmail } from "@/lib/email";
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
 * Morning results email (Vercel Cron, ~7:30am ET).
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
  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <p style="font-size: 13px; color: #666;">MoyLine AI · Morning results · ${yesterday}</p>
      <h1 style="font-size: 28px; margin: 8px 0;">${headline}</h1>
      ${
        highlights.length > 0
          ? `<ul style="line-height: 1.7;">${highlights.map((h) => `<li>${h}</li>`).join("")}</ul>`
          : `<p style="color: #666;">Full breakdown in today's 7am brief.</p>`
      }
      <p style="margin-top: 24px;"><a href="https://moyline-ai.vercel.app/picks" style="background: #f5c518; color: #0a0a0a; font-weight: 800; padding: 12px 24px; border-radius: 10px; text-decoration: none;">Today's card</a></p>
      <p style="font-size: 11px; color: #888; margin-top: 24px;">Analysis for entertainment purposes — not financial advice.</p>
    </div>`;

  let sent = 0;
  let sent = 0;
  const { unsubUrl } = await import("@/lib/unsub");
  for (const to of members) {
    const perHtml =
      html +
      `<p style="font-size: 11px; color: #888; margin-top: 16px;"><a href="${unsubUrl(to)}" style="color: #888;">Unsubscribe from these emails</a></p>`;
    if (await sendEmail(to, `MoyLine AI: ${headline}`, perHtml)) sent++;
  }
  return NextResponse.json({ ok: true, sent, date: yesterday, headline });
}
