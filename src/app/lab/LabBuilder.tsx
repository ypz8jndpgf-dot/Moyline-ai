"use client";

import { useMemo, useState } from "react";
import type { FeedPick } from "@/lib/picks";

/* ---------- odds math ---------- */

function parseOdds(price: string): number | null {
  const m = price.match(/([+-]\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function americanToDecimal(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function decimalToAmerican(dec: number): string {
  if (dec >= 2) return "+" + Math.round((dec - 1) * 100);
  return String(Math.round(-100 / (dec - 1)));
}

function parlayOdds(legs: { price: string }[]): string | null {
  let dec = 1;
  for (const leg of legs) {
    const o = parseOdds(leg.price);
    if (o === null) return null;
    dec *= americanToDecimal(o);
  }
  return decimalToAmerican(dec);
}

function extractLeague(game: string): string {
  const m = game.match(/\(([^)]+)\)/);
  return m ? m[1] : "Other";
}

/* ---------- teaser math (Wong) ---------- */

type TeasedLeg = FeedPick & { teasedLine: string; points: number };

function teaserPointsFor(league: string): number {
  const l = league.toUpperCase();
  if (l.includes("CFB") || l.includes("CBB") || l.includes("NCAAB")) return 6.5;
  return 6;
}

/** Returns the teased line if Wong-eligible, else null. */
function wongTease(pick: FeedPick): TeasedLeg | null {
  if (pick.market !== "spread" || !pick.line) return null;
  const line = parseFloat(pick.line);
  if (isNaN(line)) return null;
  const league = extractLeague(pick.game);
  const pts = teaserPointsFor(league);

  let teased: number | null = null;
  if (line <= -7.5 && line >= -8.5) {
    teased = line + pts; // tease favorite down through 7 and 3
  } else if (line >= 1.5 && line <= 2.5) {
    teased = line + pts; // tease underdog up through 3 and 7
  }
  if (teased === null) return null;

  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return { ...pick, teasedLine: fmt(teased), points: pts };
}

function rankScore(p: FeedPick): number {
  // Edge first, then confidence, then star. Missing edge sorts last within its tier.
  const edge = typeof p.edge_cents === "number" ? p.edge_cents : -1;
  return edge * 100 + p.confidence * 10 + (p.star ? 5 : 0);
}

/* ---------- component ---------- */

export default function LabBuilder({
  picks,
  props = [],
}: {
  picks: FeedPick[];
  props?: FeedPick[];
}) {
  const [betType, setBetType] = useState<"parlay" | "teaser">("parlay");
  const [legCount, setLegCount] = useState(2);
  const [sport, setSport] = useState("All");

  const leagues = useMemo(() => {
    const s = new Set([...picks, ...props].map((p) => extractLeague(p.game)));
    return ["All", ...Array.from(s).sort()];
  }, [picks, props]);

  const result = useMemo(() => {
    // Player props are always eligible for parlays — never for teasers.
    const parlayPool = [...picks, ...props]
      .filter((p) => sport === "All" || extractLeague(p.game) === sport)
      .sort((a, b) => rankScore(b) - rankScore(a));

    if (betType === "parlay") {
      const legs = parlayPool.slice(0, legCount);
      if (legs.length < 2) {
        return { error: "Not enough qualifying legs on today's card for a parlay." };
      }
      const odds = parlayOdds(legs);
      return {
        legs,
        combined: odds,
        note: odds
          ? `Combined ${odds} via standard parlay math. Shop the best price per leg.`
          : "Combined odds unavailable — a leg price couldn't be parsed.",
      };
    }

    // teaser — props excluded (can't tease a prop)
    const pool = picks
      .filter((p) => sport === "All" || extractLeague(p.game) === sport)
      .sort((a, b) => rankScore(b) - rankScore(a));
    const eligible = pool
      .map(wongTease)
      .filter((x): x is TeasedLeg => x !== null);
    if (eligible.length < 2) {
      return {
        error:
          "No Wong-eligible teaser legs on today's card. (Need spreads of -7.5 to -8.5 or +1.5 to +2.5.)",
      };
    }
    const legs = eligible.slice(0, Math.max(2, Math.min(legCount, eligible.length)));
    const pts = legs[0].points;
    return {
      legs,
      combined: null,
      teaserPoints: pts,
      note: `Standard ${pts}-pt ${legs.length}-team teaser pays around -110 — shop for the best number.`,
    };
  }, [picks, props, betType, legCount, sport]);

  const pill = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-sm font-bold border transition ${
      active
        ? "bg-gold text-ink border-gold"
        : "border-line text-muted hover:text-paper hover:border-gold/50"
    }`;

  return (
    <div>
      {/* controls */}
      <div className="card p-5 mb-6">
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted mb-2">Bet type</p>
          <div className="flex gap-2">
            <button className={pill(betType === "parlay")} onClick={() => setBetType("parlay")}>
              Parlay
            </button>
            <button className={pill(betType === "teaser")} onClick={() => setBetType("teaser")}>
              Teaser
            </button>
          </div>
        </div>
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted mb-2">Teams / legs</p>
          <div className="flex gap-2">
            {[2, 3, 4, 5].map((n) => (
              <button key={n} className={pill(legCount === n)} onClick={() => setLegCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted mb-2">Sport</p>
          <div className="flex flex-wrap gap-2">
            {leagues.map((l) => (
              <button key={l} className={pill(sport === l)} onClick={() => setSport(l)}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* result */}
      {"error" in result ? (
        <div className="card p-8 text-center">
          <p className="text-lg mb-2">Can&apos;t build that ticket today.</p>
          <p className="text-sm text-muted">{result.error}</p>
        </div>
      ) : (
        <div className="card card-glow p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold uppercase tracking-widest text-gold">
              Best {betType === "parlay" ? "parlay" : `${result.teaserPoints}-pt teaser`}
            </span>
            {result.combined && (
              <span className="font-display text-2xl text-goldsoft">{result.combined}</span>
            )}
          </div>
          <ul className="space-y-3 mb-4">
            {result.legs!.map((leg, i) => (
              <li key={i} className="border-b border-line/50 pb-3 last:border-0 last:pb-0">
                <p className="font-bold">
                  {leg.game} {leg.star && <span className="text-gold">★</span>}
                </p>
                <p className="text-sm text-muted">
                  {betType === "parlay" ? (
                    <>
                      {leg.play} <span className="text-goldsoft">{leg.price}</span>
                    </>
                  ) : (
                    <>
                      {leg.play} →{" "}
                      <span className="text-goldsoft font-bold">{(leg as TeasedLeg).teasedLine}</span>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">{result.note}</p>
        </div>
      )}
      <p className="text-xs text-muted mt-6">
        Built from today&apos;s card — highest edges first. Analysis for entertainment purposes —
        not financial advice.
      </p>
    </div>
  );
}
