"use client";

import { useEffect, useState } from "react";
import type { LiveGame } from "@/lib/live-scores";

/**
 * Live scoreline for a card pick (optimization #28). One shared fetch feeds
 * every card on the page; each card matches its own game by team names.
 * Renders nothing until ESPN says the game is in progress or final.
 */

let cache: { at: number; games: LiveGame[] } | null = null;
let inflight: Promise<LiveGame[]> | null = null;

function loadScores(): Promise<LiveGame[]> {
  if (cache && Date.now() - cache.at < 45_000) return Promise.resolve(cache.games);
  if (!inflight) {
    inflight = fetch("/api/live-scores")
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .then((j) => {
        cache = { at: Date.now(), games: (j.games || []) as LiveGame[] };
        inflight = null;
        return cache.games;
      })
      .catch(() => {
        inflight = null;
        return cache?.games || [];
      });
  }
  return inflight;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function teamHit(token: string, variants: string[]): boolean {
  const t = norm(token);
  if (!t) return false;
  return variants.some((v) => {
    const n = norm(v);
    return (
      n === t ||
      n.endsWith(" " + t) ||
      t.endsWith(" " + n) ||
      (t.length >= 4 && n.includes(t)) ||
      (n.length >= 4 && t.includes(n))
    );
  });
}

function matchGame(gameStr: string, games: LiveGame[]): LiveGame | null {
  const clean = (gameStr || "").split("(")[0];
  const parts = clean.split(/\s+@\s+|\s+vs\.?\s+/i);
  if (parts.length !== 2) return null;
  const away = parts[0].trim();
  const home = parts[1].trim();
  return (
    games.find((g) => teamHit(away, g.away) && teamHit(home, g.home)) ||
    games.find(
      (g) =>
        (teamHit(away, g.away) || teamHit(away, g.home)) &&
        (teamHit(home, g.away) || teamHit(home, g.home))
    ) ||
    null
  );
}

type Verdict = "Win" | "Loss" | "Push";

/**
 * Settle a prop against the box-score result the server attached to the
 * game (optimization #67): the server parsed the play and read the
 * player's actual stat from the final ESPN box score, so this is a bare
 * comparison. No attached result (unparseable play, player unmatched,
 * sport the box-score engine doesn't cover) → no marker.
 */
function settleProp(g: LiveGame, play: string): Verdict | null {
  const r = (g.propResults || []).find((x) => x.play === play);
  if (!r) return null;
  if (r.value === r.line) return "Push";
  const won = r.direction === "over" ? r.value > r.line : r.value < r.line;
  return won ? "Win" : "Loss";
}

const PROP_STAT_HINT =
  /(pass|rush|receiv|points?|rebounds?|assists?|yards|yds|receptions?|completions?|strikeouts?|saves|shots|goals|steals|blocks|threes|touchdowns?|tds)\b/i;

/**
 * A prop that arrives without its market label ("Booker Over 24.5
 * points") would otherwise be misread as a game total from its
 * Over/Under. It reads as a prop when it carries a stat market and its
 * subject is a player — i.e. not one of the two teams playing.
 */
function looksLikeProp(g: LiveGame, play: string): boolean {
  if (!PROP_STAT_HINT.test(play)) return false;
  if (/team total/i.test(play)) return false;
  const subject = play
    .split(/\b(?:over|under)\b/i)[0]
    .replace(/\d+(\.\d+)?\s*\+.*$/, "")
    .trim();
  if (!subject) return false;
  return !teamHit(subject, g.away) && !teamHit(subject, g.home);
}

/**
 * Settle a score-decidable pick against the final score (optimization #64):
 * moneylines, spreads and game totals from the scoreline; props from the
 * box-score results the server attaches (#67). Display convenience only;
 * the official result still comes from the morning grader.
 */
function settlePick(
  g: LiveGame,
  play: string,
  market?: string,
  line?: string
): Verdict | null {
  const p = (play || "").trim();
  const mkt =
    market ||
    (/\bml\b/i.test(p)
      ? "ml"
      : /\b(over|under)\b/i.test(p)
        ? "total"
        : /[+-]\d+(\.\d+)?\s*$/.test(p)
          ? "spread"
          : undefined);
  if (mkt === "prop") return settleProp(g, p);
  if (!mkt) return null;
  // Unlabeled prop: never let its Over/Under fall into the game-total
  // branch below.
  if (!market && mkt === "total" && looksLikeProp(g, p)) {
    return settleProp(g, p);
  }
  const away = parseInt(g.awayScore, 10);
  const home = parseInt(g.homeScore, 10);
  if (isNaN(away) || isNaN(home)) return null;

  if (mkt === "total") {
    const num = parseFloat(line || p.match(/(\d+(\.\d+)?)\s*$/)?.[1] || "");
    if (isNaN(num)) return null;
    const sum = away + home;
    if (sum === num) return "Push";
    return /\bover\b/i.test(p) === sum > num ? "Win" : "Loss";
  }

  // Moneyline / spread: identify the picked side from the play text.
  const numMatch = p.match(/([+-]\d+(?:\.\d+)?)\s*$/);
  const teamToken = p
    .replace(/\bml\b/i, "")
    .replace(/([+-]\d+(?:\.\d+)?)\s*$/, "")
    .trim();
  if (!teamToken) return null;
  const pickedAway = teamHit(teamToken, g.away);
  const pickedHome = teamHit(teamToken, g.home);
  if (pickedAway === pickedHome) return null; // both or neither — ambiguous
  const mine = pickedAway ? away : home;
  const theirs = pickedAway ? home : away;

  if (mkt === "ml") {
    if (mine > theirs) return "Win";
    if (mine < theirs) return "Loss";
    // Level at full time: a 3-way soccer moneyline loses on the draw;
    // everywhere else the stake comes back.
    return g.sport === "MLS" || g.sport === "Soccer" ? "Loss" : "Push";
  }
  // spread
  const spread = parseFloat(line || numMatch?.[1] || "");
  if (isNaN(spread)) return null;
  const covered = mine + spread - theirs;
  if (covered > 0) return "Win";
  if (covered < 0) return "Loss";
  return "Push";
}

export default function LiveScore({
  game,
  play,
  market,
  line,
}: {
  game: string;
  play?: string;
  market?: string;
  line?: string;
}) {
  const [g, setG] = useState<LiveGame | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const games = await loadScores();
      if (alive) setG(matchGame(game, games));
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [game]);

  if (!g || g.state === "pre") return null;
  const awayLabel = g.away[2] || g.away[1] || g.away[0];
  const homeLabel = g.home[2] || g.home[1] || g.home[0];
  if (g.state === "post") {
    const verdict = play ? settlePick(g, play, market, line) : null;
    return (
      <p className="text-xs text-muted mb-2">
        Final · {awayLabel} {g.awayScore} — {homeLabel} {g.homeScore}
        {verdict === "Win" && (
          <span className="ml-2 font-bold text-up">✓ Won</span>
        )}
        {verdict === "Loss" && (
          <span className="ml-2 font-bold text-down">✗ Lost</span>
        )}
        {verdict === "Push" && (
          <span className="ml-2 font-bold text-paper/70">· Push</span>
        )}
      </p>
    );
  }
  return (
    <p className="text-xs font-bold text-down mb-2">
      ● {awayLabel} {g.awayScore} — {homeLabel} {g.homeScore}
      {g.detail ? ` · ${g.detail}` : ""}
    </p>
  );
}
