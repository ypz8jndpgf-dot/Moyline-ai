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

export default function LiveScore({ game }: { game: string }) {
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
    return (
      <p className="text-xs text-muted mb-2">
        Final · {awayLabel} {g.awayScore} — {homeLabel} {g.homeScore}
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
