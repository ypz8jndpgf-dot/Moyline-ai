import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { refreshOdds, getQuotaRemaining, getOdds, getOpenings } from "@/lib/odds";
import { buildBoard } from "@/lib/board";
import { getPicksFeed } from "@/lib/picks";
import { captureClvLines } from "@/lib/clv";
import { selectCardSteamMoves } from "@/lib/card-utils";
import { getMemberEmails, sendEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const STEAM_PREFIX = "moyline:steam:alerted:";

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
  return s.replace(/^[\"']+|[\"']+$/g, "");
}

/**
 * Scheduled refresh endpoint (Vercel Cron hits this 4x daily).
 * Protected by CRON_SECRET when set (Vercel sends it as a Bearer <redacted>
 *
 * After refreshing odds, checks for NEW steam moves on card games and
 * emails members a digest (each distinct move alerts once per 24h).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    const result = await refreshOdds(true);

    // CLV capture (fire-and-forget; never awaited, never fails or delays
    // the refresh). Upserts the just-fetched board line for every
    // not-yet-started pick on today's card — the last write before a
    // game's start is its closing proxy. Zero extra Odds API calls.
    void captureClvLines(result.events).catch((e) =>
      console.error("[refresh] clv capture failed:", e instanceof Error ? e.message : e)
    );

    // Steam alerts on card games (best-effort; never fails the refresh).
    let steamAlerts = 0;
    try {
      steamAlerts = await alertCardSteam();
    } catch (e) {
      console.error("[refresh] steam alert failed:", e instanceof Error ? e.message : e);
    }

    // Target-line alerts (best-effort; never fails the refresh).
    let lineAlerts = 0;
    try {
      const base = (process.env.NEXTAUTH_URL || "https://www.moylineai.com").trim();
      const res = await fetch(`${base}/api/cron/check-alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        lineAlerts = data.triggered || 0;
      }
    } catch (e) {
      console.error("[refresh] line alert check failed:", e instanceof Error ? e.message : e);
    }

    // Tailed-pick alerts (best-effort; never fails the refresh).
    let tailAlerts = 0;
    try {
      const base = (process.env.NEXTAUTH_URL || "https://www.moylineai.com").trim();
      const res = await fetch(`${base}/api/cron/tail-alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        tailAlerts = data.sent || 0;
      }
    } catch (e) {
      console.error("[refresh] tail alert check failed:", e instanceof Error ? e.message : e);
    }

    return NextResponse.json({
      ok: true,
      fetchedAt: result.fetchedAt,
      sportsRefreshed: result.sportsRefreshed,
      gameCount: result.events.length,
      quotaRemaining: getQuotaRemaining(),
      steamAlerts,
      lineAlerts,
      tailAlerts,
      error: result.error || null,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Refresh failed" },
      { status: 500 }
    );
  }
}

async function alertCardSteam(): Promise<number> {
  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) return 0;

  const feed = await getPicksFeed();
  if (!feed || feed.picks.length === 0) return 0;

  const [oddsResult, openings] = await Promise.all([getOdds(), getOpenings()]);
  const { games, movers } = buildBoard(oddsResult.events, openings);

  // Only steam moves in a pick's own game, own market AND own side,
  // collapsed to one line per game+market+side across books
  // (see selectCardSteamMoves in card-utils).
  const selected = selectCardSteamMoves(feed.picks, games, movers);
  console.log(
    `[steam] selected ${selected.length} card steam move(s)` +
      (selected.length
        ? `: ${selected.map((s) => `${s.game} — ${s.label} (${s.detail})`).join("; ")}`
        : "")
  );

  const redis = new Redis({ url, token });
  const fresh: { game: string; label: string; detail: string }[] = [];

  for (const mv of selected) {
    // Dedupe on the COLLAPSED move identity (game+market+side, all books).
    const key = STEAM_PREFIX + Buffer.from(mv.id).toString("base64url").slice(0, 80);
    let seen: unknown = await redis.get(key);
    if (!seen) {
      // v2 guard: v2 keyed dedupe per book (and listed both sides of a
      // spread). If this move was already alerted under any v2 id it
      // subsumes, don't re-alert it tonight under the v3 key.
      for (const pid of mv.priorIds) {
        const priorKey =
          STEAM_PREFIX + Buffer.from(pid).toString("base64url").slice(0, 80);
        if (await redis.get(priorKey)) {
          seen = "v2";
          break;
        }
      }
    }
    if (!seen) {
      // Migration guard: pre-fix keys were base64(game|raw mover label), one
      // per book×column cell. If any raw mover collapsed into this line was
      // already alerted under the old scheme, don't re-alert the same move
      // tonight under the new key.
      for (const lbl of mv.sourceLabels) {
        const legacyKey =
          STEAM_PREFIX + Buffer.from(`${mv.game}|${lbl}`).toString("base64url").slice(0, 80);
        if (await redis.get(legacyKey)) {
          seen = "legacy";
          break;
        }
      }
    }
    if (!seen) {
      await redis.set(key, "1", { ex: 24 * 3600 });
      fresh.push({ game: mv.game, label: mv.label, detail: mv.detail });
    }
  }

  if (fresh.length === 0) return 0;

  const members = await getMemberEmails();
  if (members.length === 0) return 0;

  const html = `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <p style="font-size: 13px; color: #666;">MoyLine AI · Steam alert</p>
      <h1 style="font-size: 24px; margin: 8px 0;">🔥 Line moving on your card</h1>
      <ul style="line-height: 1.8;">
        ${fresh.map((f) => `<li><strong>${f.game}</strong> — ${f.label} <span style="color:#666">(${f.detail})</span></li>`).join("")}
      </ul>
      <p style="margin-top: 20px;"><a href="https://moylineai.com/picks" style="background: #f5c518; color: #0a0a0a; font-weight: 800; padding: 12px 24px; border-radius: 10px; text-decoration: none;">View card</a></p>
      <p style="font-size: 11px; color: #888; margin-top: 20px;">Analysis for entertainment purposes — not financial advice.</p>
    </div>`;

  let sent = 0;
  for (const to of members) {
    if (await sendEmail(to, `🔥 Steam alert: ${fresh.length} line move${fresh.length > 1 ? "s" : ""} on your card`, html)) sent++;
  }
  return sent;
}
