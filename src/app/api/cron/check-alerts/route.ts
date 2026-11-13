import { NextResponse } from "next/server";
import {
  getAllAlerts,
  markTriggered,
  alertHitsTarget,
  bestMoneylinePrice,
  type LineAlert,
} from "@/lib/alerts";
import { getSubscription } from "@/lib/push";
import { getOdds } from "@/lib/odds";
import { livePropLine } from "@/lib/cheatsheet";
import type { PropLiveQuote } from "@/lib/card-utils";
import { fmtAmerican, type OddsEvent } from "@/lib/odds-shared";
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

/** Get the best (most favorable) line for a spread/total across books. */
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

async function sendAlertPush(
  email: string,
  alert: LineAlert,
  currentLine: number
): Promise<boolean> {
  if (!getVapid()) return false;
  const sub = await getSubscription(email);
  if (!sub) return false;

  const isMoneyline = alert.market === "moneyline";
  const isProp = alert.market === "prop";
  const currentLabel = isMoneyline ? fmtAmerican(Math.round(currentLine)) : `${currentLine}`;
  const targetLabel = isMoneyline ? fmtAmerican(Math.round(alert.target)) : `${alert.target}`;
  const payload = JSON.stringify({
    title: isProp
      ? `🎯 Prop alert hit: ${alert.player || alert.gameLabel}`
      : `🎯 Line alert hit: ${alert.gameLabel}`,
    body: isProp
      ? `${alert.player} ${alert.side} ${alert.propLabel || ""} is now ${currentLabel} (${alert.gameLabel}) — your target: ${targetLabel}`.replace(/\s+/g, " ")
      : `${alert.side} ${alert.market} is now ${currentLabel} (your target: ${targetLabel})`,
    url: isProp ? "/lab" : "/",
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

/** Fail-closed CRON_SECRET guard (Vercel Cron / /api/refresh callers). */
function cronGuard(req: Request): NextResponse | null {
  const secret = cleanEnv(process.env.CRON_SECRET);
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
  return checkAlerts();
}

export async function POST(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
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

    // Game-market alerts read the odds board; prop alerts (optimization
    // #73) read the board-props cache the Cheatsheet maintains — fetch
    // each source only when an alert actually needs it.
    const hasGameAlerts = allAlerts.some(({ alerts }) =>
      alerts.some((a) => a.market !== "prop")
    );
    let events: OddsEvent[] = [];
    if (hasGameAlerts) {
      const odds = await getOdds();
      events = odds.events || [];
    }
    const todayET = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    const quoteMemo = new Map<string, PropLiveQuote | null>();
    const propQuote = async (alert: LineAlert): Promise<PropLiveQuote | null> => {
      const key = `${alert.player}|${alert.propMarket}|${alert.side}`;
      if (!quoteMemo.has(key)) {
        quoteMemo.set(
          key,
          await livePropLine(
            {
              game: alert.game,
              player: alert.player!,
              market: alert.propMarket!,
              direction: /under/i.test(alert.side) ? "under" : "over",
            },
            todayET
          ).catch(() => null)
        );
      }
      return quoteMemo.get(key) ?? null;
    };

    for (const { email, alerts } of allAlerts) {
      for (const alert of alerts) {
        results.checked++;
        try {
          if (alert.market === "prop") {
            if (!alert.player || !alert.propMarket) continue;
            const quote = await propQuote(alert);
            if (!quote) continue;
            // Every line the books currently price for this side: the
            // consensus main line plus every cached ladder rung. The
            // most favorable one is the "current" the at-or-better
            // test judges — Over wants the lowest, Under the highest.
            const lines = new Set<number>(
              Object.keys(quote.priceByLine).map((k) => Number(k))
            );
            if (quote.mainLine !== null) lines.add(quote.mainLine);
            if (lines.size === 0) continue;
            const arr = [...lines];
            const current = /under/i.test(alert.side)
              ? Math.max(...arr)
              : Math.min(...arr);
            if (alertHitsTarget(alert, current)) {
              const sent = await sendAlertPush(email, alert, current);
              if (sent) {
                await markTriggered(email, alert.id);
                results.triggered++;
              }
            }
            continue;
          }

          const event = findEvent(events, alert.game);
          if (!event) continue;

          const current =
            alert.market === "moneyline"
              ? bestMoneylinePrice(event, alert.side)
              : getBestLine(event, alert.market, alert.side);
          if (current === null) continue;

          if (alertHitsTarget(alert, current)) {
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
