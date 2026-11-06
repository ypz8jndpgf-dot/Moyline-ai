"use client";

import { useEffect, useState } from "react";
import type { CheatLeg } from "@/lib/cheatsheet";

/**
 * Real L5/L10 hit rate for a Notable props strip lean (optimization #46).
 * One shared fetch of /api/cheatsheet feeds every prop on the page (same
 * shared-cache pattern as LiveScore); each strip row matches its leg by
 * the sheet's own id ("game|play") and renders the muted fraction line
 * only when the Cheatsheet engine actually covered that prop — real ESPN
 * box scores, ≥3 logged games. Anything uncovered (other sports, thin
 * logs, unparseable play) renders nothing. Never a guessed rate.
 */

type Sheet = { legs: CheatLeg[] };

let cache: { at: number; legs: CheatLeg[] } | null = null;
let inflight: Promise<CheatLeg[]> | null = null;

function loadLegs(): Promise<CheatLeg[]> {
  if (cache && Date.now() - cache.at < 300_000) return Promise.resolve(cache.legs);
  if (!inflight) {
    inflight = fetch("/api/cheatsheet")
      .then((r) => (r.ok ? r.json() : { legs: [] }))
      .then((j) => {
        cache = { at: Date.now(), legs: ((j as Sheet).legs || []) as CheatLeg[] };
        inflight = null;
        return cache.legs;
      })
      .catch(() => {
        inflight = null;
        return cache?.legs || [];
      });
  }
  return inflight;
}

export default function PropHitRate({
  game,
  play,
}: {
  game: string;
  play: string;
}) {
  const [leg, setLeg] = useState<CheatLeg | null>(null);

  useEffect(() => {
    let alive = true;
    loadLegs().then((legs) => {
      if (!alive) return;
      // Brief leans only: board top-up legs are book props, not MoyLine
      // leans, and never belong on this strip even on a text collision.
      setLeg(
        legs.find((l) => l.source === "brief" && l.id === `${game}|${play}`) ??
          null
      );
    });
    return () => {
      alive = false;
    };
  }, [game, play]);

  if (!leg) return null;
  const { l5, l10 } = leg.splits;
  if (l10.n === 0) return null;
  return (
    <p className="text-[11px] text-muted mt-1">
      📊 Hit {l10.hits} of last {l10.n}
      {l5.n > 0 && (
        <>
          {" "}· {l5.hits} of last {l5.n}
        </>
      )}{" "}
      <span className="text-muted/70">(game logs, ESPN)</span>
    </p>
  );
}
