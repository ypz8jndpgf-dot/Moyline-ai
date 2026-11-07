import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getAllTails } from "@/lib/tails";
import { getPrefs } from "@/lib/prefs";
import { sendPushTo } from "@/lib/push";
import { getPicksFeed, type FeedPick } from "@/lib/picks";
import { getTrackRecord } from "@/lib/store";
import { gradeTail, tailUnits } from "@/lib/tail-results";
import { formatUnits } from "@/lib/records";
import { getOdds, getOpenings } from "@/lib/odds";
import { buildBoard } from "@/lib/board";
import { findBoardGame, bestPriceForPick, movedAgainstNote, movedInFavorNote } from "@/lib/card-utils";

/**
 * Tailed-pick alerts (optimization #19, 2026-10-28).
 * Runs after each odds refresh (called by /api/refresh, same cadence as
 * the target-line alerts — morning + evening). For members who opted in
 * (prefs.tailAlerts) and have a push subscription, sends at most one
 * push per tail per kind:
 *  - "moved": the live board line for the tailed pick's own side moved
 *    against the published price (same test as the /picks warning note).
 *  - "favorable": the live board line for the tailed pick's own side is
 *    now a strictly better number to bet than the published one
 *    (optimization #35, 2026-11-02 — e.g. an ML published -120 now -102).
 *  - "start": the game starts within the next 3 hours.
 *  - "settled": the tailed pick has been graded (win / loss / push) —
 *    checked against the track record for yesterday's and today's
 *    tails, so the first refresh after the 6:30am grading sends it
 *    (optimization #57). Settled pushes need no board, so they are
 *    checked before the odds-board early return.
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

/** ET date `daysAgo` days before today (noon-UTC anchored, DST-safe). */
function etDateDaysAgo(daysAgo: number): string {
  const d = new Date(`${todayET()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
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
  return checkTailAlerts();
}

export async function POST(req: Request) {
  const denied = cronGuard(req);
  if (denied) return denied;
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

    const today = todayET();
    const now = Date.now();

    // Settled-tail pushes (#57) read the graded record, not the board.
    // Window: yesterday + today ET — the grader settles yesterday's
    // card at 6:30am and this check runs at the next odds refresh.
    const settledDates = new Set([etDateDaysAgo(1), today]);
    let trackPicks: Awaited<ReturnType<typeof getTrackRecord>>["picks"] = [];
    try {
      trackPicks = (await getTrackRecord()).picks;
    } catch {
      trackPicks = [];
    }

    for (const { email, tails } of all) {
      const todays = tails.filter((t) => t.date === today);
      const settledCandidates = tails.filter((t) => settledDates.has(t.date));
      if (todays.length === 0 && settledCandidates.length === 0) continue;
      const prefs = await getPrefs(email);
      if (!prefs.tailAlerts) continue;

      // Settled: one push per graded tailed pick, with the member's
      // units at the price they tailed at (the /my-tails convention).
      for (const tail of settledCandidates) {
        results.checked++;
        try {
          const graded = gradeTail(tail, trackPicks);
          if (!graded || graded.result === "Pending") continue;
          const units = tailUnits(tail, graded);
          const unitsText = units !== null ? `, ${formatUnits(units)}` : "";
          const payload =
            graded.result === "Win"
              ? {
                  title: "✅ Your tail won",
                  body: `${tail.game} — ${tail.play} cashed${unitsText}`,
                  url: "/my-tails",
                }
              : graded.result === "Loss"
                ? {
                    title: "❌ Your tail lost",
                    body: `${tail.game} — ${tail.play} didn't cash${unitsText}`,
                    url: "/my-tails",
                  }
                : {
                    title: "↩️ Your tail pushed",
                    body: `${tail.game} — ${tail.play} pushed${unitsText}`,
                    url: "/my-tails",
                  };
          const sent = await sendOnce(
            redis,
            email,
            tail.date,
            "settled",
            tail.game,
            tail.play,
            payload,
            90 * 24 * 3600
          );
          if (sent) results.sent++;
        } catch (e) {
          results.errors.push(
            `${email} ${tail.game}: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }

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
            const best = bestPriceForPick(pick, bg);
            const note = movedAgainstNote(pick, best);
            if (note) {
              const sent = await sendOnce(redis, email, tail.date, "moved", tail.game, tail.play, {
                title: `📉 Line moved against your tail`,
                body: `${tail.game} — ${note}`,
                url: "/my-tails",
              });
              if (sent) results.sent++;
            }

            // Line moved in the tail's favor: a better number than the
            // card published is now on offer (optimization #35).
            const favorNote = movedInFavorNote(pick, best);
            if (favorNote) {
              const sent = await sendOnce(redis, email, tail.date, "favorable", tail.game, tail.play, {
                title: `📈 Line moved in your favor`,
                body: `${tail.game} — ${favorNote}`,
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
  kind: "moved" | "favorable" | "start" | "settled",
  game: string,
  play: string,
  payload: { title: string; body: string; url?: string },
  ttlSeconds = 36 * 3600
): Promise<boolean> {
  const id = Buffer.from(`${email}|${date}|${kind}|${game}|${play}`).toString("base64url").slice(0, 120);
  const key = SENT_PREFIX + id;
  if (await redis.get(key)) return false;
  const ok = await sendPushTo(email, payload);
  if (!ok) return false;
  await redis.set(key, "1", { ex: ttlSeconds });
  return true;
}
