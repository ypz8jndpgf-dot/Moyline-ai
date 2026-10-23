import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Redis } from "@upstash/redis";
import { sendEmail } from "@/lib/email";
import { getPicksFeed } from "@/lib/picks";
import { briefSignInUrl } from "@/lib/brief-signin";

const ADMIN = (process.env.ADMIN_EMAIL || "").toLowerCase();

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/**
 * Admin beta-list management. No redeploy needed — changes take effect immediately.
 * GET    /api/admin/beta          -> { members: [...] }
 * POST   /api/admin/beta { email } -> adds one
 * DELETE /api/admin/beta { email } -> removes one
 * Bearer PICKS_UPDATE_SECRET also accepted (for CLI/script use).
 */
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret && secret === process.env.PICKS_UPDATE_SECRET) return true;
  const session = await auth();
  return !!session?.user?.email && session.user.email.toLowerCase() === ADMIN;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "redis not configured" }, { status: 500 });
  const members = await redis.smembers("moyline:beta");
  return NextResponse.json({ members: (members || []).sort() });
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { email } = await req.json();
  if (!email || typeof email !== "string" || !email.includes("@"))
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "redis not configured" }, { status: 500 });
  const normalized = email.trim().toLowerCase();
  const addedCount = await redis.sadd("moyline:beta", normalized);
  const members = await redis.smembers("moyline:beta");

  // Welcome email for genuinely new members (sadd adds 1 only the first
  // time). Best-effort: a mail failure never fails the add itself.
  let welcomed = false;
  if (addedCount === 1) {
    // Today's top plays ride along in the welcome, so a new member's first
    // taste is today's card — not tomorrow's 7am brief. Best-effort: an
    // empty/stale feed just omits the block.
    let topPicksHtml = "";
    try {
      const feed = await getPicksFeed();
      const top = (feed?.picks || [])
        .slice()
        .sort(
          (a, b) =>
            Number(b.star || false) - Number(a.star || false) ||
            (b.confidence || 0) - (a.confidence || 0) ||
            (b.edge_cents || 0) - (a.edge_cents || 0)
        )
        .slice(0, 3);
      if (top.length > 0) {
        const esc = (s: string) =>
          (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const rows = top
          .map(
            (p) => `
          <div style="padding:9px 14px;border-bottom:1px solid #262626;">
            <span style="color:#ddd;font-size:14px;">${p.star ? "★ " : ""}<strong style="color:#fff;">${esc(p.play)}</strong> <span style="color:#999;">— ${esc(p.game)}</span></span>
            <span style="float:right;color:#f5c518;font-size:13px;font-weight:700;">${esc(p.price)}</span>
          </div>`
          )
          .join("");
        topPicksHtml = `
            <div style="border:1px solid #333;margin:0 0 22px;">
              <div style="background:#1a1a1a;border-bottom:2px solid #f5c518;padding:10px 14px;color:#f5c518;font-size:11px;font-weight:800;letter-spacing:1px;">🔥 TODAY'S TOP PLAYS — ALREADY ON THE CARD</div>
              ${rows}
              <p style="color:#999;font-size:12px;margin:0;padding:10px 14px;">Sign in below to see the full card with write-ups.</p>
            </div>`;
      }
    } catch {
      /* welcome email still goes out without the picks block */
    }
    // The welcome's sign-in button is itself a one-click sign-in link
    // (single-use, 24h) — a new member's first tap should just work.
    const signInUrl = await briefSignInUrl(normalized);
    try {
      welcomed = await sendEmail(
        normalized,
        "You're in — welcome to MoyLine AI",
        `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0a0a;">
        <tr><td align="center" style="padding:0;">
        <table role="presentation" width="720" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:720px;background-color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
          <tr><td style="background-color:#0a0a0a;border-bottom:3px solid #f5c518;padding:30px 24px 22px 24px;text-align:center;">
            <div style="font-size:32px;font-weight:900;color:#f5c518;letter-spacing:5px;line-height:1;">MOYLINE AI</div>
            <div style="font-size:12px;font-weight:700;color:#ffe9a3;letter-spacing:7px;margin-top:10px;">MEMBERSHIP ACTIVATED</div>
            <div style="font-size:13px;color:#999999;margin-top:12px;">Data-driven picks across every major sport — every play graded and published.</div>
          </td></tr>
          <tr><td style="padding:26px 24px 8px 24px;">
            <h1 style="font-family:'Arial Black','Helvetica Neue',Arial,sans-serif;color:#ffffff;font-size:30px;letter-spacing:1px;margin:0 0 10px;">YOU'RE IN<span style="color:#f5c518;">.</span></h1>
            <p style="color:#cccccc;font-size:15px;line-height:1.6;margin:0 0 22px;">
              This address now has <strong style="color:#ffffff;">full member access</strong> to MoyLine AI — no payment, no card, nothing to buy. Here's everything you need.
            </p>
            ${topPicksHtml}
            <div style="border:1px solid #333;margin:0 0 22px;">
              <div style="background:#1a1a1a;border-bottom:2px solid #f5c518;padding:10px 14px;color:#f5c518;font-size:11px;font-weight:800;letter-spacing:1px;">HOW TO SIGN IN (30 SECONDS)</div>
              <div style="padding:16px 18px;">
                <ol style="color:#dddddd;font-size:14px;line-height:1.7;margin:0;padding-left:18px;">
                  <li>Go to <a href="https://moylineai.com/signin" style="color:#f5c518;">moylineai.com/signin</a></li>
                  <li>Enter this exact email address — we'll send you a magic sign-in link (no password)</li>
                  <li>Open the link in your browser and you're in</li>
                </ol>
                <p style="color:#cccccc;font-size:13px;line-height:1.55;margin:12px 0 0;"><strong style="color:#ffffff;">On your phone:</strong> open the sign-in link in Safari or Chrome, not inside your email app. In the Gmail app, long-press the link and tap "Open in Safari" — links opened inside Gmail don't stay signed in.</p>
                <p style="color:#cccccc;font-size:13px;line-height:1.55;margin:8px 0 0;"><strong style="color:#ffffff;">Shortcut:</strong> the gold button below signs you in with one tap — no email round-trip (link works for 24 hours).</p>
              </div>
            </div>
            <div style="border:1px solid #333;margin:0 0 26px;">
              <div style="background:#1a1a1a;border-bottom:2px solid #f5c518;padding:10px 14px;color:#f5c518;font-size:11px;font-weight:800;letter-spacing:1px;">WHAT YOU GET</div>
              <ul style="color:#dddddd;font-size:14px;line-height:1.7;margin:0;padding:14px 18px 14px 32px;">
                <li><strong style="color:#ffffff;">The daily brief</strong> — every morning at 7am ET, straight to this inbox</li>
                <li><strong style="color:#ffffff;">Today's Card</strong> — the day's researched plays with confidence ratings</li>
                <li><strong style="color:#ffffff;">Lines board</strong> — every game's lines vs. the opening benchmark, best price highlighted</li>
                <li><strong style="color:#ffffff;">Ask MoyAI</strong> — ask about any matchup, get the lines and a lean</li>
                <li><strong style="color:#ffffff;">Parlay Lab + Ticket Builder</strong> — build parlays and teasers off the day's edges</li>
              </ul>
            </div>
            <div style="text-align:center;">
              <a href="${signInUrl}" style="display:inline-block;background:#f5c518;color:#0a0a0a;font-weight:900;padding:14px 40px;border-radius:10px;text-decoration:none;font-size:16px;">SIGN IN →</a>
              <p style="color:#888888;font-size:12px;margin:16px 0 0;">Your first brief arrives tomorrow at 7am ET.</p>
            </div>
            <p style="text-align:center;margin:28px 0 0;">
              <span style="color:#f5c518;font-weight:900;letter-spacing:2px;font-size:13px;">MOYLINE AI</span>
              <span style="color:#666666;font-size:11px;"> — live lines, steam alerts, pro picks.</span>
            </p>
            <p style="color:#666666;font-size:11px;text-align:center;margin:6px 0 0;">Analysis for entertainment purposes — not financial advice.</p>
          </td></tr>
        </table>
        </td></tr>
        </table>`
      );
    } catch (e) {
      console.error("[beta] welcome email failed:", e instanceof Error ? e.message : e);
    }
  }

  return NextResponse.json({ added: normalized, count: members?.length || 0, welcomed });
}

export async function DELETE(req: NextRequest) {
  if (!(await authorized(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { email } = await req.json();
  if (!email || typeof email !== "string")
    return NextResponse.json({ error: "email required" }, { status: 400 });
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "redis not configured" }, { status: 500 });
  const normalized = email.trim().toLowerCase();
  await redis.srem("moyline:beta", normalized);
  const members = await redis.smembers("moyline:beta");
  return NextResponse.json({ removed: normalized, count: members?.length || 0 });
}
