import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Redis } from "@upstash/redis";
import { sendEmail } from "@/lib/email";

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
    try {
      welcomed = await sendEmail(
        normalized,
        "You're in — welcome to MoyLine AI",
        `
        <div style="background:#0a0a0a;padding:32px 16px;font-family:Arial,sans-serif;">
          <div style="max-width:560px;margin:0 auto;background:#111;border:1px solid #333;border-radius:12px;padding:36px 28px;">
            <div style="text-align:center;margin-bottom:8px;">
              <div style="font-size:13px;color:#f5c518;font-weight:700;letter-spacing:2px;">MOYLINE AI</div>
            </div>
            <h1 style="color:#fff;font-size:26px;text-align:center;margin:8px 0 4px;">You're in. 🎉</h1>
            <p style="color:#ccc;font-size:15px;line-height:1.6;text-align:center;margin:0 0 24px;">
              This address now has <strong style="color:#fff;">full member access</strong> to MoyLine AI — no payment, no card, nothing to buy.
            </p>
            <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:18px 20px;margin-bottom:20px;">
              <p style="color:#f5c518;font-size:12px;font-weight:700;letter-spacing:1px;margin:0 0 10px;">HOW TO SIGN IN (30 SECONDS)</p>
              <ol style="color:#ddd;font-size:14px;line-height:1.7;margin:0;padding-left:18px;">
                <li>Go to <a href="https://moylineai.com/signin" style="color:#f5c518;">moylineai.com/signin</a></li>
                <li>Enter this exact email address — we'll send you a magic sign-in link (no password)</li>
                <li>Open the link in your browser and you're in</li>
              </ol>
              <p style="color:#ccc;font-size:13px;line-height:1.55;margin:12px 0 0;">📱 <strong>On your phone:</strong> open the sign-in link in Safari or Chrome, not inside your email app. In the Gmail app, long-press the link and tap "Open in Safari" — links opened inside Gmail don't stay signed in.</p>
            </div>
            <p style="color:#f5c518;font-size:12px;font-weight:700;letter-spacing:1px;margin:0 0 10px;">WHAT YOU GET</p>
            <ul style="color:#ddd;font-size:14px;line-height:1.7;margin:0 0 24px;padding-left:18px;">
              <li><strong style="color:#fff;">The daily brief</strong> — every morning at 7am ET, straight to this inbox</li>
              <li><strong style="color:#fff;">Today's Card</strong> — the day's researched plays with confidence ratings</li>
              <li><strong style="color:#fff;">Lines board</strong> — every game's lines vs. the opening benchmark, best price highlighted</li>
              <li><strong style="color:#fff;">Ask MoyAI</strong> — ask about any matchup, get the lines and a lean</li>
              <li><strong style="color:#fff;">Parlay Lab + Ticket Builder</strong> — build parlays and teasers off the day's edges</li>
            </ul>
            <div style="text-align:center;">
              <a href="https://moylineai.com/signin" style="display:inline-block;background:#f5c518;color:#0a0a0a;font-weight:900;padding:14px 40px;border-radius:10px;text-decoration:none;font-size:16px;">SIGN IN →</a>
              <p style="color:#888;font-size:12px;margin:16px 0 0;">Your first brief arrives tomorrow at 7am ET.</p>
            </div>
            <p style="color:#666;font-size:11px;text-align:center;margin:24px 0 0;">Analysis for entertainment purposes — not financial advice.</p>
          </div>
        </div>`
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
