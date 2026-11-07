import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess, getTrackRecord } from "@/lib/store";
import { readTails } from "@/lib/tails";
import { formatUnits } from "@/lib/records";
import { getPicksFeed, type FeedPick } from "@/lib/picks";
import { getOdds, getOpenings } from "@/lib/odds";
import { buildBoard } from "@/lib/board";
import { findBoardGame, bestPriceForPick, type BestPrice } from "@/lib/card-utils";
import { parseProp } from "@/lib/cheatsheet";
import { gradeTail, tailUnits } from "@/lib/tail-results";
import TailAlertsToggle from "./TailAlertsToggle";

export const dynamic = "force-dynamic";

/** Board ML cells render as "(+120)" — show the bare price in the now-line. */
function livePriceLabel(display: string): string {
  return display.startsWith("(") && display.endsWith(")")
    ? display.slice(1, -1)
    : display;
}

export default async function MyTailsPage() {
  const session = await auth();
  const email = session?.user?.email || null;
  const sub = await getSubscription(email || "");
  const allowed = await hasAccess(email, sub);

  if (!allowed) {
    return (
      <div className="max-w-xl mx-auto text-center py-10">
        <h1 className="font-display text-4xl mb-4">MY TAILS</h1>
        <p className="text-muted mb-6">Members can tap “Tailed it” on any pick and track their own record here.</p>
        {session?.user ? (
          <span className="inline-block px-8 py-3 rounded-full border border-gold/40 text-gold/70 font-bold text-xs tracking-[0.25em]">
            BETA — INVITE ONLY
          </span>
        ) : (
          <Link href="/signin" className="btn-gold px-8 py-3 inline-block">
            Sign in
          </Link>
        )}
      </div>
    );
  }

  const tails = await readTails(email!);
  const rec = await getTrackRecord();
  const graded = tails.map((t) => ({ tail: t, result: gradeTail(t, rec.picks) }));

  // Live prices for still-pending tails (optimization #55): the same
  // cached board + best-price lookup the card uses, so a member can see
  // whether the number they tailed still holds or has drifted. Pregame
  // only — a started game's in-play price is not the same market — and
  // game markets only: props have no cell on the game board.
  const liveByTail = new Map<number, BestPrice>();
  try {
    const [feed, oddsResult, openings] = await Promise.all([
      getPicksFeed(),
      getOdds(),
      getOpenings(),
    ]);
    const { games } = buildBoard(oddsResult.events, openings);
    const feedMap = new Map<string, FeedPick>();
    for (const p of [
      ...(feed?.picks || []),
      ...(feed?.props || []),
      ...(feed?.backpage || []),
    ]) {
      feedMap.set(`${p.game}|${p.play}`, p);
    }
    const now = Date.now();
    tails.forEach((tail, i) => {
      const result = graded[i].result;
      if (result && result.result !== "Pending") return;
      const pick: FeedPick =
        feedMap.get(`${tail.game}|${tail.play}`) ||
        ({ game: tail.game, play: tail.play, price: tail.price, confidence: 0 } as FeedPick);
      if ((pick.market || "").toLowerCase() === "prop") return;
      // A pick the feed no longer carries could still be a prop; never
      // let a prop's Over/Under inherit the game total's board cell.
      if (!feedMap.has(`${tail.game}|${tail.play}`) && parseProp(tail.play)) return;
      const bg = findBoardGame(pick, games);
      if (!bg || Date.parse(bg.commence) <= now) return;
      const best = bestPriceForPick(pick, bg);
      if (best) liveByTail.set(i, best);
    });
  } catch {
    /* odds unavailable — tails render without live prices */
  }
  const gradedWithLive = graded.map((g, i) => ({
    ...g,
    live: liveByTail.get(i) ?? null,
  }));

  const w = graded.filter((g) => g.result?.result === "Win").length;
  const l = graded.filter((g) => g.result?.result === "Loss").length;
  const p = graded.filter((g) => g.result?.result === "Push").length;
  const pending = graded.length - w - l - p;
  const gradedCount = w + l + p;
  const winPct = w + l > 0 ? (w / (w + l)) * 100 : null;

  // Units at the price the member tailed at (optimization #32): flat 1u
  // risked per tail, same convention as the paper ledger, computed with the
  // shared records.ts price math. The tail's own price string is the
  // published price ("-110 (FanDuel)"); fall back to the graded record's
  // line when a tail carries no parseable price. Units are quoted over the
  // priced tails only, and the coverage is stated when it isn't complete.
  let units = 0;
  let priced = 0;
  for (const { tail, result } of graded) {
    const u = tailUnits(tail, result);
    if (u !== null) {
      priced++;
      units += u;
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-display text-4xl mb-1">
        MY <span className="gold-text">TAILS</span>
      </h1>
      <p className="text-muted text-sm mb-6">
        {email} · {w}-{l}-{p}
        {winPct !== null && <span> · {winPct.toFixed(1)}%</span>}
        {gradedCount > 0 && priced > 0 && (
          <span> · {formatUnits(units)}{priced < gradedCount && <span className="text-muted"> (on {priced} of {gradedCount} graded)</span>}</span>
        )}
        {pending > 0 && <span className="text-muted"> · {pending} pending</span>}
      </p>

      <TailAlertsToggle />

      {tails.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg mb-2">Nothing tailed yet.</p>
          <p className="text-sm text-muted mb-6">
            Tap “Tailed it” on any card pick and it lands here with your record.
          </p>
          <Link href="/picks" className="btn-gold px-6 py-2 inline-block">
            View today&apos;s card
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {gradedWithLive
            .slice()
            .reverse()
            .map(({ tail, result, live }, i) => (
              <div key={i} className="card p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-bold">{tail.game}</p>
                  <p className="text-sm text-goldsoft">
                    {tail.play} <span className="text-muted">{tail.price}</span>
                  </p>
                  {live && (
                    <p className="text-xs mt-1">
                      <span className="text-muted">Tailed {tail.price}</span>
                      <span className="text-muted"> · </span>
                      <span className="text-paper font-semibold">
                        Now {livePriceLabel(live.display)}
                      </span>
                      <span className="text-muted"> at {live.book}</span>
                    </p>
                  )}
                  <p className="text-xs text-muted">{tail.date}</p>
                  {result?.final && <p className="text-xs text-muted mt-1">{result.final}</p>}
                </div>
                <span
                  className={`text-sm font-bold px-3 py-1 rounded ${
                    result?.result === "Win"
                      ? "text-up"
                      : result?.result === "Loss"
                        ? "text-down"
                        : "text-muted"
                  }`}
                >
                  {result ? result.result : "Pending"}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
