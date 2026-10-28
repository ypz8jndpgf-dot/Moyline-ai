import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getAllTails } from "@/lib/tails";
import { getPrefs } from "@/lib/prefs";
import { sendPushTo } from "@/lib/push";
import { getPicksFeed, type FeedPick } from "@/lib/picks";
import { getOdds, getOpenings } from "@/lib/odds";
import { buildBoard } from "@/lib/board";
import { findBoardGame, bestPriceForPick, movedAgainstNote } from "@/lib/card-utils";

/**
 * Tailed-pick alerts (optimization #19, 2026-10-28).
 * Runs after each odds refresh (called by /api/refresh, same cadence as
 * the target-line alerts — morning + evening). For members who opted in
 * (prefs.tailAlerts) and have a push subscription, sends at most one
 * push per tail per kind:
 *  - "moved": the live board line for the tailed pick's own side moved
 *    against the published price (same test as the /picks warning note).
 *  - "start": the game starts within the next 3 hours.
 * Dedupe marks are written only after a push is actually accepted.
 */
export const dynamic = "force-dynamic";

const SENT_PREFIX = "moyline:tailalert:";
/** At a twice-daily refresh cadence, "starting soon" = within 3 hours. */
const START_WINDOW_MIN = 180;

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
  return s.replace(/^["']+|["']+$/g, "");
}

function getRedis(): Redis | null {
  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function formatStartET(iso: string): string {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "";
  return (
    dt
      .toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "America/New_York",
      })
      .replace(" ", "")
      .toLowerCase() + " ET"
  );
}

export async function GET() {
  return checkTailAlerts();
}

export async function POST() {
  return checkTailAlerts();
}

async function checkTailAlerts() {
  const results = { checked: 0, sent: 0, errors: [] as string[] };
  try {
    const redis = getRedis();
    if (!redis) return NextResponse.json({ ok: true, ...results, message: "No storage" });

    const all = await getAllTails();
    if (all.length === 0) return NextResponse.json({ ok: true, ...results, message: "No tails" });

    const feed = await getPicksFeed();
    const feedMap = new Map<string, FeedPick>();
    for (const p of [...(feed?.picks || []), ...(feed?.props || [])]) {
      feedMap.set(`${p.game}|${p.play}`, p);
    }

    const [oddsResult, openings] = await Promise.all([getOdds(), getOpenings()]);
    const { games } = buildBoard(oddsResult.events, openings);
    if (games.length === 0) return NextResponse.json({ ok: true, ...results, message: "No odds data" });

    const today = todayET();
    const now = Date.now();

    for (const { email, tails } of all) {
      const todays = tails.filter((t) => t.date === today);
      if (todays.length === 0) continue;
      const prefs = await getPrefs(email);
      if (!prefs.tailAlerts) continue;

      for (const tail of todays) {
        results.checked++;
        try {
          const pick: FeedPick =
            feedMap.get(`${tail.game}|${tail.play}`) ||
            ({ game: tail.game, play: tail.play, price: tail.price, confidence: 0 } as FeedPick);
          const bg = findBoardGame(pick, games);
          if (!bg) continue;

          const commenceMs = Date.parse(bg.commence);
          const started = !isNaN(commenceMs) && commenceMs <= now;

          // Line moved against the tail (never after the game starts).
          if (!started) {
            const note = movedAgainstNote(pick, bestPriceForPick(pick, bg));
            if (note) {
              const sent = await sendOnce(redis, email, tail.date, "moved", tail.game, tail.play, {
                title: `📉 Line moved against your tail`,
                body: `${tail.game} — ${note}`,
                url: "/my-tails",
              });
              if (sent) results.sent++;
            }
          }

          // Starting soon.
          if (!isNaN(commenceMs)) {
            const minsUntil = (commenceMs - now) / 60000;
            if (minsUntil > 0 && minsUntil <= START_WINDOW_MIN) {
              const startLabel = pick.starts || formatStartET(bg.commence);
              const sent = await sendOnce(redis, email, tail.date, "start", tail.game, tail.play, {
                title: `⏰ Starting soon: ${tail.game}`,
                body: `Your tail ${tail.play} ${tail.price}${startLabel ? ` — starts ${startLabel}` : ""}`,
                url: "/my-tails",
              });
              if (sent) results.sent++;
            }
          }
        } catch (e) {
          results.errors.push(
            `${email} ${tail.game}: ${e instanceof Error ? e.message : String(e)}`
          );
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

/** Sends a push once per (member, date, kind, game, play); dedupe mark only on success. */
async function sendOnce(
  redis: Redis,
  email: string,
  date: string,
  kind: "moved" | "start",
  game: string,
  play: string,
  payload: { title: string; body: string; url?: string }
): Promise<boolean> {
  const id = Buffer.from(`${email}|${date}|${kind}|${game}|${play}`).toString("base64url").slice(0, 120);
  const key = SENT_PREFIX + id;
  if (await redis.get(key)) return false;
  const ok = await sendPushTo(email, payload);
  if (!ok) return false;
  await redis.set(key, "1", { ex: 36 * 3600 });
  return true;
}
