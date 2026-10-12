import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { placePaperBets, getBankroll } from "@/lib/paper";

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) {
    s = s.slice(eq + 1).trim();
  }
  return s.replace(/^["']+|["']+$/g, "");
}

const FEED_KEY = "moyline:picks:today";

/**
 * One-time seed: places paper bets for every pick currently on today's card,
 * including backpage leans (tagged source="backpage", admin-only view).
 * Protected by PICKS_UPDATE_SECRET. Safe to call repeatedly (dedupes).
 */
export async function POST(req: Request) {
  const secret = cleanEnv(process.env.PICKS_UPDATE_SECRET);
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "PICKS_UPDATE_SECRET not configured" },
      { status: 500 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) {
    return NextResponse.json({ ok: false, error: "Upstash not configured" }, { status: 500 });
  }

  try {
    const redis = new Redis({ url, token });
    const raw = await redis.get<string>(FEED_KEY);
    if (!raw) {
      return NextResponse.json({ ok: false, error: "No card today" }, { status: 404 });
    }
    const feed = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
      date: string;
      picks: { game: string; play: string; price: string }[];
      backpage?: { game: string; play: string; price: string }[];
    };
    const placed = await placePaperBets(
      (feed.picks || []).map((p) => ({ game: p.game, play: p.play, price: p.price })),
      feed.date
    );
    const bpPlaced = await placePaperBets(
      (feed.backpage || []).map((p) => ({ game: p.game, play: p.play, price: p.price })),
      feed.date,
      "backpage"
    );
    const bankroll = await getBankroll();
    return NextResponse.json({
      ok: true,
      placed: placed.length,
      backpage_placed: bpPlaced.length,
      bankroll: Math.round(bankroll * 100) / 100,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "seed failed" },
      { status: 500 }
    );
  }
}
