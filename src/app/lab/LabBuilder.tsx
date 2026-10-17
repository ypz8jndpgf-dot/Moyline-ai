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

/** Every sport the site covers — the filter lists all of them, not just today's. */
const ALL_SPORTS = [
  "NFL",
  "CFB",
  "NBA",
  "NHL",
  "MLB",
  "MLS",
  "EPL",
  "La Liga",
  "Bundesliga",
  "Serie A",
  "Ligue 1",
  "Brasileirão",
  "UCL",
];

/** Normalize a feed league label to the canonical sport name. */
function normalizeSport(league: string): string {
  const l = league.trim().toUpperCase();
  const aliases: Record<string, string> = {
    NCAAF: "CFB",
    NCAAB: "CBB",
    "LA LIGA": "La Liga",
    BUNDESLIGA: "Bundesliga",
    "SERIE A": "Serie A",
    "LIGUE 1": "Ligue 1",
    "BRASILEIRAO": "Brasileirão",
    "CHAMPIONS LEAGUE": "UCL",
  };
  if (aliases[l]) return aliases[l];
  const hit = ALL_SPORTS.find((s) => s.toUpperCase() === l);
  return hit || league;
}

/* ---------- teaser math (Wong) ---------- */

type TeasedLeg = FeedPick & { teasedLine: string; points: number };

function teaserPointsFor(sport: string): number {
  const l = sport.toUpperCase();
  if (l === "CFB" || l === "CBB") return 6.5;
  return 6;
}

/** Returns the teased line if Wong-eligible, else null. */
function wongTease(pick: FeedPick): TeasedLeg | null {
  if (pick.market !== "spread" || !pick.line) return null;
  const line = parseFloat(pick.line);
  if (isNaN(line)) return null;
  const sport = normalizeSport(extractLeague(pick.game));
  const pts = teaserPointsFor(sport);

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

  const leagues = useMemo(() => ["All", ...ALL_SPORTS], []);

  const matchesSport = (p: FeedPick) =>
    sport === "All" || normalizeSport(extractLeague(p.game)) === sport;

  const result = useMemo(() => {
    // Player props are always eligible for parlays — never for teasers.
    const parlayPool = [...picks, ...props]
      .filter(matchesSport)
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
    const pool = picks.filter(matchesSport).sort((a, b) => rankScore(b) - rankScore(a));
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
    `px-4 py-2.5 sm:px-3 sm:py-1.5 rounded-full text-sm font-bold border transition min-h-[44px] sm:min-h-0 inline-flex items-center justify-center ${
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
                  {leg.starts && (
                    <span className="text-xs font-normal text-muted ml-2">🕐 {leg.starts}</span>
                  )}
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
