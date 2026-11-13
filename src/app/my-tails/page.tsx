import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess, getTrackRecord } from "@/lib/store";
import { readTails } from "@/lib/tails";
import { formatUnits } from "@/lib/records";
import { getPicksFeed, type FeedPick } from "@/lib/picks";
import { getOdds, getOpenings } from "@/lib/odds";
import { buildBoard } from "@/lib/board";
import {
  findBoardGame,
  bestPriceForPick,
  hedgeQuoteForPick,
  hedgeMath,
  type BestPrice,
  type HedgeQuote,
  type HedgeMath,
} from "@/lib/card-utils";
import { parseAmericanOdds } from "@/lib/winprob";
import { parseProp } from "@/lib/cheatsheet";
import { gradeTail, tailUnits } from "@/lib/tail-results";
import TailAlertsToggle from "./TailAlertsToggle";
import ExportTailsCsv, { type TailCsvRow } from "./ExportTailsCsv";
import ShareRecordButton from "./ShareRecordButton";
import { recordShareParams, recordLabel } from "@/lib/record-share";
import PickStatusBanner from "@/components/PickStatusBanner";
import LiveScore from "@/app/picks/LiveScore";
import StartsIn from "@/app/picks/StartsIn";

export const dynamic = "force-dynamic";

/** Board ML cells render as "(+120)" — show the bare price in the now-line. */
function livePriceLabel(display: string): string {
  return display.startsWith("(") && display.endsWith(")")
    ? display.slice(1, -1)
    : display;
}

type TailHedge = { quote: HedgeQuote; math: HedgeMath; tailAmerican: number };

/** "$91.46" / "-$6.71" — display rounding only; the math stays exact. */
function fmtMoney(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${r < 0 ? "-" : ""}$${Math.abs(r).toFixed(2)}`;
}

/** "+$35.73" / "-$6.71" / "$0.00" for net figures. */
function fmtSignedMoney(v: number): string {
  const r = Math.round(v * 100) / 100;
  if (r === 0) return "$0.00";
  return `${r > 0 ? "+" : "-"}$${Math.abs(r).toFixed(2)}`;
}

function fmtAmerican(v: number): string {
  return v > 0 ? `+${v}` : `${v}`;
}

/** Signed point for prose: 4.5 → "+4.5", -3.5 → "-3.5", 48 → "48". */
function fmtPt(v: number): string {
  const s = v % 1 === 0 ? String(Math.round(v)) : String(v);
  return v > 0 ? `+${s}` : s;
}

/** Board snapshot time for the hedge panel's freshness line, ET. */
function fmtBoardTime(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    })
    .replace(" ", "")
    .toLowerCase();
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
  // "Lock it in" hedge math (optimization #60): for the same pending,
  // pregame, game-market tails, the board's other side of the tailed
  // market at its best current price, plus the exact per-$100 lock /
  // half-hedge figures. Same cached board as the live prices — no new
  // odds pulls. Props and unmirrorable markets resolve to null inside
  // hedgeQuoteForPick and simply get no panel.
  const hedgeByTail = new Map<number, TailHedge>();
  // Publication status per tail (optimization #62), from today's feed —
  // the voided/corrected banner renders on the row, and a voided tail
  // gets no live price or hedge math: the play is dead. Read from the
  // feed alone (its own try), so the banner survives an odds outage.
  const statusByTail = new Map<number, FeedPick>();
  // The tail's own feed pick (any status) — drives the live-state row
  // (#68): its starts time feeds the countdown, its market/line feed the
  // live-score settler.
  const feedPickByTail = new Map<number, FeedPick>();
  try {
    const statusFeed = await getPicksFeed();
    const statusMap = new Map<string, FeedPick>();
    const allMap = new Map<string, FeedPick>();
    for (const p of [
      ...(statusFeed?.picks || []),
      ...(statusFeed?.props || []),
      ...(statusFeed?.backpage || []),
    ]) {
      allMap.set(`${p.game}|${p.play}`, p);
      if (p.status) statusMap.set(`${p.game}|${p.play}`, p);
    }
    tails.forEach((tail, i) => {
      const fp = statusMap.get(`${tail.game}|${tail.play}`);
      if (fp) statusByTail.set(i, fp);
      const any = allMap.get(`${tail.game}|${tail.play}`);
      if (any) feedPickByTail.set(i, any);
    });
  } catch {
    /* feed unavailable — tails render without status banners */
  }
  let boardAsOf = 0;
  try {
    const [feed, oddsResult, openings] = await Promise.all([
      getPicksFeed(),
      getOdds(),
      getOpenings(),
    ]);
    boardAsOf = oddsResult.fetchedAt || 0;
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
      // A voided play is dead — no live price, no hedge math (#62).
      if (statusByTail.get(i)?.status === "voided") return;
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
      const quote = hedgeQuoteForPick(pick, bg);
      const tailAmerican = parseAmericanOdds(tail.price);
      if (quote && tailAmerican !== null) {
        const math = hedgeMath(tailAmerican, quote.otherPrice);
        if (math) hedgeByTail.set(i, { quote, math, tailAmerican });
      }
    });
  } catch {
    /* odds unavailable — tails render without live prices */
  }
  const gradedWithLive = graded.map((g, i) => ({
    ...g,
    live: liveByTail.get(i) ?? null,
    hedge: hedgeByTail.get(i) ?? null,
    statusPick: statusByTail.get(i) ?? null,
    feedPick: feedPickByTail.get(i) ?? null,
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

  // Share-your-record card (optimization #75): the signed snapshot is
  // built from these exact graded numbers, and the card route verifies
  // the signature before rendering any of them — the card can only
  // ever show what this page issued from the member's stored tails.
  const shareStats = {
    w,
    l,
    p,
    units: Math.round(units * 100) / 100,
    priced,
    graded: gradedCount,
  };
  const sharePath = `/share-record?${recordShareParams(shareStats).toString()}`;
  const shareText = `My tails: ${recordLabel(shareStats)} · ${formatUnits(shareStats.units)}`;

  // CSV export rows (optimization #66) — the same graded data the page
  // renders, in tail order: date · game · play · price · result · units.
  const csvRows: TailCsvRow[] = graded.map(({ tail, result }) => {
    const u = tailUnits(tail, result);
    return {
      date: tail.date,
      game: tail.game,
      play: tail.play,
      price: tail.price,
      result: result?.result ?? "Pending",
      units: u !== null ? u.toFixed(2) : "",
    };
  });

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

      {tails.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ExportTailsCsv rows={csvRows} />
          {gradedCount > 0 && priced > 0 && (
            <ShareRecordButton path={sharePath} recordText={shareText} />
          )}
        </div>
      )}

      <p className="text-sm mb-4">
        <Link href="/inbox" className="text-gold font-bold hover:text-goldsoft">
          📥 What did I miss? →
        </Link>{" "}
        <span className="text-muted">Every alert we&apos;ve sent you, kept for 7 days.</span>
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
            .map(({ tail, result, live, hedge, statusPick, feedPick }, i) => (
              <div key={i} className="card p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-bold">{tail.game}</p>
                  <p
                    className={`text-sm text-goldsoft ${statusPick?.status === "voided" ? "line-through opacity-60" : ""}`}
                  >
                    {tail.play} <span className="text-muted">{tail.price}</span>
                  </p>
                  {statusPick && <PickStatusBanner p={statusPick} className="mt-2" />}
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
                  {/* Live state for a still-pending tail (optimization
                      #68): the same countdown + live scoreline the card
                      itself shows, so this page doubles as the place to
                      watch your own bets. Graded tails keep the badge on
                      the right; voided plays are dead. Both components
                      render nothing when they have nothing to say. */}
                  {(!result || result.result === "Pending") &&
                    statusPick?.status !== "voided" && (
                      <>
                        {feedPick && (
                          <StartsIn starts={feedPick.starts} date={tail.date} />
                        )}
                        <LiveScore
                          game={tail.game}
                          play={tail.play}
                          market={feedPick?.market}
                          line={feedPick?.line}
                        />
                      </>
                    )}
                  {hedge && (
                    <details className="mt-2 group">
                      <summary className="text-xs font-bold text-gold cursor-pointer list-none flex items-center gap-1">
                        <span className="transition-transform group-open:rotate-90">▶</span>
                        🔒 Lock it in — hedge math
                      </summary>
                      <div className="mt-2 space-y-1 text-xs">
                        <p className="text-muted">
                          The other side right now:{" "}
                          <span className="text-paper font-semibold">
                            {hedge.quote.otherLabel} ({fmtAmerican(hedge.quote.otherPrice)})
                          </span>{" "}
                          at {hedge.quote.otherBook}
                        </p>
                        {hedge.quote.pointMoved && hedge.quote.market === "total" && (
                          <p className="text-muted">
                            You tailed {tail.play} — the board is at{" "}
                            {fmtPt(Math.abs(hedge.quote.otherPoint ?? 0))} now, so the hedge
                            prices the current number. A finish between the two numbers wins
                            both.
                          </p>
                        )}
                        {hedge.quote.pointMoved && hedge.quote.market === "spread" && (
                          <p className="text-muted">
                            You tailed {fmtPt(hedge.quote.tailPoint ?? 0)} — the other side is{" "}
                            {fmtPt(hedge.quote.otherPoint ?? 0)} now, so the hedge prices the
                            current line. A finish between the two numbers can win both or lose
                            both.
                          </p>
                        )}
                        <p>
                          <span className="font-bold text-paper">Full lock:</span>{" "}
                          {fmtMoney(hedge.math.fullHedge)} on the other side →{" "}
                          {fmtSignedMoney(hedge.math.fullNet)} either way
                        </p>
                        <p>
                          <span className="font-bold text-paper">Half hedge:</span>{" "}
                          {fmtMoney(hedge.math.halfHedge)} → worst case{" "}
                          {fmtSignedMoney(hedge.math.halfNetOtherWins)}; if your tail hits,{" "}
                          {fmtSignedMoney(hedge.math.halfNetTailWins)}
                        </p>
                        <p className="text-[11px] text-muted">
                          Per $100 on your tail at {fmtAmerican(hedge.tailAmerican)}. A push
                          returns stakes and isn&apos;t in the math.
                          {boardAsOf > 0 && (
                            <> Board price as of {fmtBoardTime(boardAsOf)} ET.</>
                          )}{" "}
                          Just the math — what you do with it is your call.
                        </p>
                      </div>
                    </details>
                  )}
                </div>
                <span
                  className={`text-sm font-bold px-3 py-1 rounded ${
                    statusPick?.status === "voided" &&
                    (!result || result.result === "Pending")
                      ? "text-down"
                      : result?.result === "Win"
                        ? "text-up"
                        : result?.result === "Loss"
                          ? "text-down"
                          : "text-muted"
                  }`}
                >
                  {statusPick?.status === "voided" &&
                  (!result || result.result === "Pending")
                    ? "Voided"
                    : result
                      ? result.result
                      : "Pending"}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
