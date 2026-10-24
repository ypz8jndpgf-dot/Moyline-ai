import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOddsCached, getOpenings } from "@/lib/odds";
import { getPicksFeed } from "@/lib/picks";
import { getShowcaseRecords } from "@/lib/records";
import { answerQuestion, type AskData, type ChatTurn } from "@/lib/ask-engine";
import { recordAskStat } from "@/lib/ask-stats";

/**
 * Ask MoyAI — conversational endpoint.
 *
 * The client sends the new question plus the recent chat history (last ~10
 * turns, assistant turns carry the game ids they referenced). The engine in
 * src/lib/ask-engine.ts resolves follow-ups against that history and composes
 * a natural-language reply strictly from real data: the cached odds board
 * (zero API credits per question), today's picks feed, and the track record.
 */

const MAX_QUESTION = 500;
const MAX_HISTORY = 10;
const MAX_TURN_TEXT = 1000;

function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const t of raw.slice(-MAX_HISTORY)) {
    if (!t || typeof t !== "object") continue;
    const role = (t as any).role === "user" ? "user" : "assistant";
    const text = typeof (t as any).text === "string" ? (t as any).text.slice(0, MAX_TURN_TEXT) : "";
    if (!text) continue;
    const gameIds = Array.isArray((t as any).gameIds)
      ? (t as any).gameIds.filter((x: unknown) => typeof x === "string").slice(0, 12)
      : undefined;
    turns.push({ role, text, gameIds });
  }
  return turns;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Sign in to ask MoyAI." }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question || question.length > MAX_QUESTION) {
      return NextResponse.json({ error: "Ask me about a team, a matchup, tonight's board, today's card, or the record." }, { status: 400 });
    }
    const history = sanitizeHistory(body?.history);

    // Cache-only: zero API credits per question (user approved stale data)
    const { events, fetchedAt } = await getOddsCached();
    if (!events || events.length === 0) {
      return NextResponse.json({
        error: "Odds board is empty right now — try again after the next refresh.",
      }, { status: 503 });
    }

    const staleMins = fetchedAt ? Math.round((Date.now() - fetchedAt) / 60000) : null;

    const [openings, feed, records] = await Promise.all([
      getOpenings().catch(() => ({})),
      getPicksFeed().catch(() => null),
      getShowcaseRecords().catch(() => null),
    ]);

    const data: AskData = {
      events,
      openings: openings || {},
      card: feed?.picks || [],
      props: feed?.props || [],
      teaser: feed?.teaser
        ? { legs: feed.teaser.legs, points: feed.teaser.points, confidence: feed.teaser.confidence }
        : null,
      parlay: feed?.parlay
        ? { legs: feed.parlay.legs, odds: (feed.parlay as any).odds, confidence: feed.parlay.confidence }
        : null,
      lookaheadTeaser: feed?.lookaheads?.teaser
        ? {
            legs: feed.lookaheads.teaser.legs,
            points: feed.lookaheads.teaser.points,
            confidence: feed.lookaheads.teaser.confidence,
            target_date: feed.lookaheads.teaser.target_date,
          }
        : null,
      records: records
        ? {
            allTime: records.allTime,
            stars: records.stars,
            sinceRecal: records.sinceRecal,
            last7: records.last7,
            showStars: records.showStars,
            showSinceRecal: records.showSinceRecal,
            showLast7: records.showLast7,
          }
        : null,
    };

    const { reply, gameIds, intent } = answerQuestion(question, history, data);

    // Usage counters (counts only, no content) — fire-and-forget.
    recordAskStat(intent);

    return NextResponse.json({
      reply,
      gameIds,
      meta: { staleMins, cached: true },
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Something broke on our end — try again." }, { status: 500 });
  }
}
