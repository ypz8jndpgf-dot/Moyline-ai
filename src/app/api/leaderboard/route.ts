import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getTrackRecord } from "@/lib/store";
import { readTails } from "@/lib/tails";

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const norm = (s: string) =>
  s.toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function gradeTail(
  tail: { game: string; play: string; date: string },
  picks: { game: string; play: string; date: string; result: string }[]
) {
  const tg = norm(tail.game);
  const tp = norm(tail.play);
  return (
    picks.find((p) => {
      if (p.date !== tail.date) return false;
      if (norm(p.play) !== tp) return false;
      const pg = norm(p.game);
      const tw = tg.split(" ").filter((w) => w.length > 2);
      const pw = pg.split(" ").filter((w) => w.length > 2);
      return tw.every((w) => pg.includes(w)) || pw.every((w) => tg.includes(w));
    }) || null
  );
}

/** Anonymize: first 2 chars of local part + *** */
function handle(email: string): string {
  const local = email.split("@")[0] || "";
  if (local.length <= 2) return local + "***";
  return local.slice(0, 2) + "***";
}

/** First tail date ("YYYY-MM-DD", ET) inside a window, or null for all-time.
 *  Week = Monday of the current ET week; month = the 1st of the ET month.
 *  Tail dates are ET feed dates, so a string compare is exact. */
function windowStart(window: string): string | null {
  if (window !== "week" && window !== "month") return null;
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  if (window === "month") return `${today.slice(0, 8)}01`;
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const sinceMonday = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - sinceMonday);
  return dt.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "not configured" }, { status: 500 });

  // Windowed boards (optimization #80): ?window=week|month restricts the
  // tally to tails dated inside the window, so a member who joins
  // mid-season has a board they can actually climb.
  const window = new URL(req.url).searchParams.get("window") || "all";
  const start = windowStart(window);

  const members = (await redis.smembers("moyline:beta")) || [];
  const rec = await getTrackRecord();
  const picks = rec.picks as { game: string; play: string; date: string; result: string }[];

  const rows = [];
  for (const email of members) {
    const allTails = await readTails(email);
    const tails = start ? allTails.filter((t) => t.date >= start) : allTails;
    if (tails.length === 0) continue;
    let w = 0, l = 0, p = 0;
    for (const t of tails) {
      const g = gradeTail(t, picks);
      if (g?.result === "Win") w++;
      else if (g?.result === "Loss") l++;
      else if (g?.result === "Push") p++;
    }
    const graded = w + l;
    rows.push({
      handle: handle(email),
      w, l, p,
      pending: tails.length - w - l - p,
      total: tails.length,
      pct: graded > 0 ? w / graded : null,
    });
  }

  // Sort by win% desc, then by graded picks desc. Min 3 graded to rank.
  rows.sort((a, b) => {
    const ap = a.pct ?? -1, bp = b.pct ?? -1;
    if (ap !== bp) return bp - ap;
    return (b.w + b.l) - (a.w + a.l);
  });

  return NextResponse.json({ leaderboard: rows, window, updated: new Date().toISOString() });
}
