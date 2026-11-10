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
 * Settle a score-decidable pick against the final score (optimization #64):
 * moneylines, spreads and game totals only — props need player stats the
 * scoreboard doesn't carry, so they get no marker. Display convenience
 * only; the official result still comes from the morning grader.
 */
function settlePick(
  g: LiveGame,
  play: string,
  market?: string,
  line?: string
): Verdict | null {
  const away = parseInt(g.awayScore, 10);
  const home = parseInt(g.homeScore, 10);
  if (isNaN(away) || isNaN(home)) return null;
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
  if (!mkt || mkt === "prop") return null;

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
