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

type TeaserLookahead = {
  type: "teaser";
  legs: string[];
  points: number;
  confidence: number;
  reasoning?: string;
  target_date: string;
};

type SpotlightLookahead = {
  type: "spotlight";
  picks: {
    game: string;
    play: string;
    price: string;
    confidence: number;
    reasoning?: string;
    edge_cents?: number;
    market?: string;
    line?: string;
  }[];
  target_date: string;
};

type Lookahead = TeaserLookahead | SpotlightLookahead;

type PicksFeed = {
  date: string; // YYYY-MM-DD (ET)
  slot: string; // latest contributing slot, e.g. "6pm"
  editions: string[]; // all contributing slots for the day
  updated_at: string; // ISO timestamp
  picks: FeedPick[];
  /** Notable player props — eligible parlay legs for the Lab builder. */
  props?: FeedPick[];
  /** Backpage: conf-3 leans. Paywalled tab, paper-traded + graded privately for admin. */
  backpage?: FeedPick[];
  teaser: Ticket | null;
  parlay: Ticket | null;
  /** Weekend lookaheads (Thu/Fri in-season briefs). Keyed by type so NFL and NCAAB coexist. */
  lookaheads?: {
    teaser?: TeaserLookahead | null;
    spotlight?: SpotlightLookahead | null;
  };
  /** @deprecated — single lookahead field; replaced by `lookaheads` map. Kept for backward compat. */
  lookahead?: Lookahead | null;
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
    (f.parlay === null || typeof f.parlay === "object") &&
    (f.lookahead === undefined || f.lookahead === null || typeof f.lookahead === "object")
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

    const { merged: mergedPicks } = mergePicks(existing?.picks || [], body.picks);
    const { merged: mergedProps } = mergePicks(existing?.props || [], body.props || []);
    const { merged: mergedBackpage } = mergePicks(existing?.backpage || [], (body as PicksFeed).backpage || []);
    const merged: PicksFeed = {
      date: body.date,
      slot: body.slot,
      editions: Array.from(
        new Set([...(existing?.editions || []), ...(existing?.slot ? [existing.slot] : []), body.slot])
      ),
      updated_at: new Date().toISOString(),
      picks: mergedPicks,
      props: mergedProps,
      backpage: mergedBackpage,
      // Latest non-null ticket wins; null never erases an earlier edition's ticket.
      teaser: body.teaser || existing?.teaser || null,
      parlay: body.parlay || existing?.parlay || null,
      // Weekend lookaheads: keyed by type so NFL teaser and NCAAB spotlight coexist.
      // Incoming single `lookahead` (from brief workers) routes to its type key; null never erases.
      // Backward compat: old single `lookahead` without a type field is treated as a teaser.
      lookaheads: (() => {
        const prev = existing?.lookaheads || {};
        // Migrate legacy single lookahead if present
        const legacy = (existing as PicksFeed)?.lookahead;
        if (legacy && !prev.teaser && !prev.spotlight) {
          const legacyType = (legacy as Lookahead).type || "teaser";
          if (legacyType === "teaser") prev.teaser = legacy as TeaserLookahead;
          else prev.spotlight = legacy as SpotlightLookahead;
        }
        const incoming = (body as PicksFeed).lookahead as Lookahead | null | undefined;
        if (incoming) {
          const t = incoming.type || "teaser";
          if (t === "teaser") prev.teaser = incoming as TeaserLookahead;
          else prev.spotlight = incoming as SpotlightLookahead;
        }
        return prev;
      })(),
      // @deprecated single field — kept null; readers use `lookaheads`.
      lookahead: null,
    };

    await redis.set(FEED_KEY, JSON.stringify(merged));

    // CARD-LIVE PUSH: the first push carrying picks for a new date fires one
    // "Today's card is live" push to opted-in members. Deduped per date via
    // an NX claim (same pattern as the settled-card push), so later editions
    // (11am/6pm merges, re-pushes, deep dives) never re-fire it. Best-effort:
    // a push failure never fails the feed update.
    let cardLivePush = 0;
    try {
      if (!existing && mergedPicks.length > 0) {
        const claimKey = `moyline:cardlive-push:${body.date}`;
        const claimed = await redis.set(claimKey, "1", { nx: true, ex: 48 * 3600 });
        if (claimed) {
          const { broadcastPush } = await import("@/lib/push");
          const top = [...mergedPicks].sort(
            (a, b) =>
              b.confidence - a.confidence || (b.edge_cents || 0) - (a.edge_cents || 0)
          )[0];
          const push = await broadcastPush({
            title: "MoyLine AI · Today's card is live",
            body: top
              ? `${mergedPicks.length} play${mergedPicks.length > 1 ? "s" : ""} posted — top: ${top.game} · ${top.play}`
              : "Today's plays are posted",
            url: "/picks",
          });
          if (push.vapid) {
            cardLivePush = push.sent;
          } else {
            // Push not configured — release the claim so a later push can send.
            await redis.del(claimKey);
          }
        }
      }
    } catch (e) {
      console.error("[card-live] push failed:", e instanceof Error ? e.message : e);
    }

    // 5-STAR ALARM: if any incoming pick has confidence 5 (never awarded before),
    // blast a massive announcement — web push + email to ALL members.
    // Deduped per pick so re-pushes don't re-fire.
    try {
      const fiveStarPicks = body.picks.filter((p: FeedPick) => p.confidence === 5);
      for (const p of fiveStarPicks) {
        const alarmKey = `moyline:5star:${body.date}:${pickKey(p)}`;
        const alreadyAlarmed = await redis.get(alarmKey);
        if (!alreadyAlarmed) {
          await redis.set(alarmKey, new Date().toISOString(), { ex: 86400 * 7 });
          const { getMemberEmails, sendEmail } = await import("@/lib/email");
          const members = await getMemberEmails();
          // Web push blast
          try {
            const base = cleanEnv(process.env.NEXTAUTH_URL) || "https://www.moylineai.com";
            const cronSecret = cleanEnv(process.env.CRON_SECRET);
            if (cronSecret) {
              await fetch(`${base}/api/push/send`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${cronSecret}`,
                },
                body: JSON.stringify({
                  title: "🚨🚨🚨 5-ALARM FIRE: 5-STAR PLAY 🚨🚨🚨",
                  body: `${p.game} — ${p.play}. Our first EVER 5-star. Get in now.`,
                  url: "/picks",
                }),
              }).catch(() => {});
            }
          } catch {}
          // Email blast
          const html = `
            <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 0; background: #0a0a0a; color: #f5f5f5;">
              <div style="background: #cc0000; padding: 16px; text-align: center;">
                <div style="font-size: 24px; font-weight: 900; color: #fff; letter-spacing: 2px;">🚨 5-ALARM FIRE 🚨</div>
              </div>
              <div style="text-align: center; padding: 40px 24px 24px;">
                <div style="font-size: 56px;">⭐⭐⭐⭐⭐</div>
                <h1 style="color: #f5c518; font-size: 36px; margin: 16px 0; font-weight: 900;">5-STAR PLAY</h1>
                <p style="font-size: 18px; color: #ccc; max-width: 400px; margin: 0 auto;">Our first-ever 5-star rated play. The highest confidence we've ever published. This almost never happens.</p>
              </div>
              <div style="background: #1a1a1a; border: 3px solid #f5c518; border-radius: 12px; padding: 28px; margin: 24px;">
                <div style="font-size: 14px; color: #f5c518; font-weight: 700; letter-spacing: 1px; margin-bottom: 8px;">THE PLAY</div>
                <div style="font-size: 22px; font-weight: 800; color: #fff;">${p.game}</div>
                <div style="font-size: 32px; font-weight: 900; margin: 12px 0; color: #f5c518;">${p.play}</div>
                <div style="font-size: 14px; color: #999;">${p.price || "Shop for best price"}</div>
                ${p.reasoning ? `<div style="font-size: 14px; color: #ccc; margin-top: 12px; line-height: 1.6;">${p.reasoning}</div>` : ""}
              </div>
              <div style="text-align: center; padding: 0 24px 40px;">
                <a href="https://moylineai.com/picks" style="display: inline-block; background: #f5c518; color: #0a0a0a; font-weight: 900; padding: 18px 48px; border-radius: 10px; text-decoration: none; font-size: 20px;">VIEW THE CARD →</a>
                <p style="font-size: 11px; color: #666; margin-top: 24px;">Analysis for entertainment purposes — not financial advice.</p>
              </div>
            </div>`;
          for (const to of members) {
            await sendEmail(to, `🚨 5-ALARM FIRE: 5-STAR PLAY — ${p.play}`, html).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.error("[5star] alarm failed:", e instanceof Error ? e.message : e);
    }

    // Paper trading: auto-place $10 virtual bets on card + backpage picks.
    // Backpage picks are paper-traded too, tagged source="backpage" (admin-only view).
    // Idempotent by design: placement is offered on EVERY push for the full
    // merged list (not just the newly-added delta), and the Lua script in
    // placePaperBets dedupes against existing bet ids. This self-heals the
    // 2026-10-11 backpage sequencing bug, where the first 6pm push stored the
    // backpage picks in the feed before the placement code was live — the
    // follow-up push then saw zero "added" picks and reported
    // backpage_bets_placed:0 even though the picks were live and unbet.
    let paperPlaced = 0;
    let backpagePlaced = 0;
    try {
      const { placePaperBets } = await import("@/lib/paper");
      const placed = await placePaperBets(
        mergedPicks.map((p) => ({ game: p.game, play: p.play, price: p.price })),
        body.date,
        "card"
      );
      paperPlaced = placed.length;
      const bpPlaced = await placePaperBets(
        mergedBackpage.map((p) => ({ game: p.game, play: p.play, price: p.price })),
        body.date,
        "backpage"
      );
      backpagePlaced = bpPlaced.length;
    } catch (e) {
      console.error("[paper] place failed:", e instanceof Error ? e.message : e);
    }

    // Open-bet counts for this card date, so a placed:0 on an idempotent
    // re-push is visibly "already placed" rather than "never placed."
    let paperOpenToday = 0;
    let backpageOpenToday = 0;
    try {
      const { countOpenBetsForDate } = await import("@/lib/paper");
      const counts = await countOpenBetsForDate(body.date);
      paperOpenToday = counts.card;
      backpageOpenToday = counts.backpage;
    } catch {
      /* informational only */
    }

    return NextResponse.json({
      ok: true,
      picks: merged.picks.length,
      card_live_push: cardLivePush,
      backpage: mergedBackpage.length,
      slot: merged.slot,
      editions: merged.editions,
      merged_into_existing: !!existing,
      paper_bets_placed: paperPlaced,
      backpage_bets_placed: backpagePlaced,
      paper_bets_open_today: paperOpenToday,
      backpage_bets_open_today: backpageOpenToday,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Redis write failed" },
      { status: 500 }
    );
  }
}
