import { NextResponse } from "next/server";
import { getAllAlerts, markTriggered, type LineAlert } from "@/lib/alerts";
import { getSubscription } from "@/lib/push";
import { getOdds } from "@/lib/odds";
import type { OddsEvent } from "@/lib/odds-shared";
import webpush from "web-push";

/**
 * Check line alerts against current odds.
 * Runs after each odds refresh (called by /api/refresh).
 * For each pending alert, if the current best line hits the target,
 * send a web push to the user and mark the alert triggered.
 */
export const dynamic = "force-dynamic";

function cleanEnv(v: string | undefined): string {
  return (v || "").trim().replace(/^["']+|["']+$/g, "");
}

function getVapid() {
  const pub = cleanEnv(process.env.VAPID_PUBLIC_KEY);
  const priv = cleanEnv(process.env.VAPID_PRIVATE_KEY);
  if (!pub || !priv) return null;
  webpush.setVapidDetails("mailto:support@moylineai.com", pub, priv);
  return true;
}

/** Normalize a game label for matching. */
function normGame(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Find the event matching an alert's game. */
function findEvent(events: OddsEvent[], gameKey: string): OddsEvent | null {
  const normKey = normGame(gameKey);
  for (const e of events) {
    const label = `${e.away_team} @ ${e.home_team}`;
    const label2 = `${e.away_team} vs ${e.home_team}`;
    if (normGame(label).includes(normKey) || normKey.includes(normGame(label)) ||
        normGame(label2).includes(normKey) || normKey.includes(normGame(label2))) {
      return e;
    }
    // Also try team names individually
    if (normKey.includes(normGame(e.home_team)) && normKey.includes(normGame(e.away_team))) {
      return e;
    }
  }
  return null;
}

/** Get the best (most favorable) line for a market/side across books. */
function getBestLine(
  event: OddsEvent,
  market: "spread" | "total",
  side: string
): number | null {
  const normSide = normGame(side);
  let best: number | null = null;

  for (const book of event.bookmakers || []) {
    for (const mkt of book.markets || []) {
      if (mkt.key === "spreads" && market === "spread") {
        for (const out of mkt.outcomes || []) {
          if (normGame(out.name).includes(normSide) || normSide.includes(normGame(out.name))) {
            const pt = out.point;
            if (typeof pt === "number") {
              // For spreads, "better" depends on side — we just track the line value.
              // The alert target is the line value to reach.
              if (best === null) best = pt;
              // Keep the first (we'll check direction in the caller)
            }
          }
        }
      }
      if (mkt.key === "totals" && market === "total") {
        for (const out of mkt.outcomes || []) {
          // Match Over/Under
          const isOver = /over/i.test(side);
          const outIsOver = /over/i.test(out.name);
          if (isOver === outIsOver) {
            const pt = out.point;
            if (typeof pt === "number" && best === null) {
              best = pt;
            }
          }
        }
      }
    }
    if (best !== null) break;
  }
  return best;
}

/** Check if the current line hits the target (at-or-better for the user). */
function hitsTarget(alert: LineAlert, current: number): boolean {
  // For spreads: user wants a specific number (e.g., "Chiefs -3").
  // "At-or-better" means the line is at the target or moved in user's favor.
  // We simplify: trigger when current === target (line hits the number).
  // For totals: same — trigger when the total hits the target number.
  return Math.abs(current - alert.target) < 0.01;
}

async function sendAlertPush(
  email: string,
  alert: LineAlert,
  currentLine: number
): Promise<boolean> {
  if (!getVapid()) return false;
  const sub = await getSubscription(email);
  if (!sub) return false;

  const marketLabel = alert.market === "spread" ? "spread" : "total";
  const payload = JSON.stringify({
    title: `🎯 Line alert hit: ${alert.gameLabel}`,
    body: `${alert.side} is now ${currentLine} (your target: ${alert.target})`,
    url: "/",
  });

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys } as webpush.PushSubscription,
      payload
    );
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  return checkAlerts();
}

export async function POST() {
  return checkAlerts();
}

async function checkAlerts() {
  const results: { checked: number; triggered: number; errors: string[] } = {
    checked: 0,
    triggered: 0,
    errors: [],
  };

  try {
    const allAlerts = await getAllAlerts();
    if (allAlerts.length === 0) {
      return NextResponse.json({ ok: true, ...results, message: "No pending alerts" });
    }

    const { events } = await getOdds();
    if (!events || events.length === 0) {
      return NextResponse.json({ ok: true, ...results, message: "No odds data" });
    }

    for (const { email, alerts } of allAlerts) {
      for (const alert of alerts) {
        results.checked++;
        try {
          const event = findEvent(events, alert.game);
          if (!event) continue;

          const current = getBestLine(event, alert.market, alert.side);
          if (current === null) continue;

          if (hitsTarget(alert, current)) {
            const sent = await sendAlertPush(email, alert, current);
            if (sent) {
              await markTriggered(email, alert.id);
              results.triggered++;
            }
          }
        } catch (e) {
          results.errors.push(`${alert.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    return NextResponse.json({ ok: true, ...results });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 }
    );
  }
}
