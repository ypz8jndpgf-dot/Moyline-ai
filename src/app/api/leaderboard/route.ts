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

export async function GET() {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const members = (await redis.smembers("moyline:beta")) || [];
  const rec = await getTrackRecord();
  const picks = rec.picks as { game: string; play: string; date: string; result: string }[];

  const rows = [];
  for (const email of members) {
    const tails = await readTails(email);
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

  return NextResponse.json({ leaderboard: rows, updated: new Date().toISOString() });
}
