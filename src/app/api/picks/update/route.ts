import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { mergeKey } from "@/lib/card-utils";

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
  deep_dive?: string;
  edge_cents?: number;
  market?: "spread" | "total" | "ml" | "prop";
  line?: string;
  added_at?: string;
  updated_at?: string;
};

type Ticket = {
  legs: string[];
  points?: number;
  odds?: string;
  book?: string;
  confidence: number;
  reasoning?: string;
};

type PicksFeed = {
  date: string; // YYYY-MM-DD (ET)
  slot: string; // latest contributing slot, e.g. "6pm"
  editions: string[]; // all contributing slots for the day
  updated_at: string; // ISO timestamp
  picks: FeedPick[];
  /** Notable player props — eligible parlay legs for the Lab builder. */
  props?: FeedPick[];
  teaser: Ticket | null;
  parlay: Ticket | null;
};

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) {
    s = s.slice(eq + 1).trim();
  }
  return s.replace(/^[\"']+|[\"']+$/g, "");
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

const pickKey = (p: FeedPick) => mergeKey(p);

/** Merge incoming picks into existing: same game+market+side replaces, new ones append. */
function mergePicks(
  existing: FeedPick[],
  incoming: FeedPick[]
): { merged: FeedPick[]; added: FeedPick[] } {
  const byKey = new Map<string, FeedPick>();
  for (const p of existing) byKey.set(pickKey(p), p);
  const now = new Date().toISOString();
  const added: FeedPick[] = [];
  for (const p of incoming) {
    const key = pickKey(p);
    const prev = byKey.get(key);
    if (!prev) added.push(p);
    byKey.set(key, {
      ...p,
      // First appearance keeps its birth timestamp; re-published plays keep
      // the original added_at and record when they were last updated.
      added_at: prev?.added_at || (p as FeedPick).added_at || now,
      updated_at: prev ? now : (p as FeedPick).updated_at,
    });
  }
  const merged = [...byKey.values()];
  // Single ★ per card: a new edition crowning a star demotes earlier ones.
  if (incoming.some((p) => p.star)) {
    const incomingStars = new Set(incoming.filter((p) => p.star).map((p) => pickKey(p)));
    for (const p of merged) {
      if (p.star && !incomingStars.has(pickKey(p))) p.star = false;
    }
  }
  return { merged, added };
}

/**
 * Receives a picks feed from the brief pipeline (off-Vercel worker).
 * Authenticated with a dedicated PICKS_UPDATE_SECRET Bearer <redacted>
 *
 * HOLISTIC CARD: pushes MERGE into the day's feed instead of replacing it.
 * Each brief/deep-dive edition contributes its picks; same game+play updates
 * in place, new plays append. A null teaser/parlay never erases an earlier
 * edition's ticket. The /picks page renders the merged day grouped by window.
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

    // Load today's existing card (if any) to merge into.
    let existing: PicksFeed | null = null;
    try {
      const raw = await redis.get<string>(FEED_KEY);
      if (raw) {
        const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as PicksFeed;
        if (parsed && parsed.date === body.date && Array.isArray(parsed.picks)) {
          existing = parsed;
        }
      }
    } catch {
      existing = null;
    }

    const { merged: mergedPicks, added: addedPicks } = mergePicks(existing?.picks || [], body.picks);
    const { merged: mergedProps } = mergePicks(existing?.props || [], body.props || []);
    const merged: PicksFeed = {
      date: body.date,
      slot: body.slot,
      editions: Array.from(
        new Set([...(existing?.editions || []), ...(existing?.slot ? [existing.slot] : []), body.slot])
      ),
      updated_at: new Date().toISOString(),
      picks: mergedPicks,
      props: mergedProps,
      // Latest non-null ticket wins; null never erases an earlier edition's ticket.
      teaser: body.teaser || existing?.teaser || null,
      parlay: body.parlay || existing?.parlay || null,
    };

    await redis.set(FEED_KEY, JSON.stringify(merged));

    // Paper trading: auto-place $10 virtual bets on brand-new card picks.
    let paperPlaced = 0;
    try {
      const { placePaperBets } = await import("@/lib/paper");
      const placed = await placePaperBets(
        addedPicks.map((p) => ({ game: p.game, play: p.play, price: p.price })),
        body.date
      );
      paperPlaced = placed.length;
    } catch (e) {
      console.error("[paper] place failed:", e instanceof Error ? e.message : e);
    }

    return NextResponse.json({
      ok: true,
      picks: merged.picks.length,
      slot: merged.slot,
      editions: merged.editions,
      merged_into_existing: !!existing,
      paper_bets_placed: paperPlaced,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Redis write failed" },
      { status: 500 }
    );
  }
}
