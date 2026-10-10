import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";

const FEED_KEY = "moyline:picks:today";

type FeedPick = {
  game: string;
  play: string;
  price: string;
  confidence: number;
  star?: boolean;
  reasoning?: string;
  starts?: string;
  writeup?: string;
};

type PicksFeed = {
  date: string; // YYYY-MM-DD (ET)
  slot: string; // e.g. "7am", "11am", "6pm", "sat2pm"
  updated_at: string; // ISO timestamp
  picks: FeedPick[];
  /** Notable player props — eligible parlay legs for the Lab builder. */
  props?: FeedPick[];
  teaser: {
    legs: string[];
    points: number;
    confidence: number;
    reasoning?: string;
  } | null;
  parlay: {
    legs: string[];
    odds: string;
    book: string;
    confidence: number;
    reasoning?: string;
  } | null;
};

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) {
    s = s.slice(eq + 1).trim();
  }
  return s.replace(/^["']+|["']+$/g, "");
}

function isValidFeed(b: unknown): b is PicksFeed {
  if (!b || typeof b !== "object") return false;
  const f = b as Record<string, unknown>;
  return (
    typeof f.date === "string" &&
    typeof f.slot === "string" &&
    Array.isArray(f.picks) &&
    (f.teaser === null || typeof f.teaser === "object") &&
    (f.parlay === null || typeof f.parlay === "object")
  );
}

/**
 * Receives the day's picks feed from the brief pipeline (off-Vercel worker).
 * Authenticated with a dedicated PICKS_UPDATE_SECRET bearer token.
 * Stores the feed in Upstash Redis; the /picks page reads it at request time.
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!isValidFeed(body)) {
    return NextResponse.json({ ok: false, error: "Invalid feed shape" }, { status: 400 });
  }

  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) {
    return NextResponse.json(
      { ok: false, error: "Upstash not configured" },
      { status: 500 }
    );
  }

  try {
    const redis = new Redis({ url, token });
    const feed: PicksFeed = {
      ...body,
      updated_at: new Date().toISOString(),
    };
    await redis.set(FEED_KEY, JSON.stringify(feed));
    return NextResponse.json({ ok: true, picks: feed.picks.length, slot: feed.slot });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Redis write failed" },
      { status: 500 }
    );
  }
}
