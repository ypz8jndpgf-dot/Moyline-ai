"use client";

import { useEffect, useState } from "react";
import type { CheatLadder, LadderRung } from "@/lib/cheatsheet";

/**
 * Prop Explorer ladder (optimization #49) for one Cheatsheet leg: the
 * alternate lines for the same player + market, best cached price per
 * rung, and the player's real hit rate at each rung from ESPN game logs.
 * Fetched lazily when a leg's trend view opens; a leg whose only priced
 * rung is its own line renders one compact row, no table chrome. A
 * failed fetch renders nothing — the trend view already shows splits.
 */

const BOOK_SHORT: Record<string, string> = {
  DraftKings: "DK",
  FanDuel: "FD",
  BetMGM: "MGM",
};

const cache = new Map<string, CheatLadder | null>();
const inflight = new Map<string, Promise<CheatLadder | null>>();

function loadLadder(id: string): Promise<CheatLadder | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id) ?? null);
  let p = inflight.get(id);
  if (!p) {
    p = fetch(`/api/cheatsheet/ladder?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const ladder = (j as CheatLadder) || null;
        cache.set(id, ladder);
        inflight.delete(id);
        return ladder;
      })
      .catch(() => {
        inflight.delete(id);
        return null;
      });
    inflight.set(id, p);
  }
  return p;
}

function rate(r: LadderRung, which: "l10" | "l5"): string {
  const s = r[which];
  return s ? `${s.hits} of ${s.n}` : "—";
}

export default function PropLadder({ legId }: { legId: string }) {
  const [ladder, setLadder] = useState<CheatLadder | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    loadLadder(legId).then((l) => {
      if (!alive) return;
      setLadder(l);
      setDone(true);
    });
    return () => {
      alive = false;
    };
  }, [legId]);

  if (!done) {
    return <p className="text-xs text-muted mb-3">Loading line ladder…</p>;
  }
  if (!ladder || ladder.rungs.length === 0) return null;

  const dirWord = ladder.direction === "over" ? "Over" : "Under";
  const priceText = (r: LadderRung) =>
    r.book ? `${r.priceLabel} ${BOOK_SHORT[r.book] || r.book}` : r.priceLabel;

  // Only the published line carries a cached price — one plain row.
  if (ladder.rungs.length === 1) {
    const r = ladder.rungs[0];
    return (
      <p className="text-xs text-muted mb-3">
        {dirWord} {r.lineLabel} · <span className="text-goldsoft">{priceText(r)}</span>
        {r.l10 && (
          <>
            {" "}· Hit {r.l10.hits} of last {r.l10.n}
            {r.l5 && <> · {r.l5.hits} of last {r.l5.n}</>}{" "}
            <span className="text-muted/70">(game logs, ESPN)</span>
          </>
        )}
      </p>
    );
  }

  return (
    <div className="mb-4">
      <p className="text-xs font-bold uppercase tracking-widest text-gold mb-2">
        Line ladder · {dirWord}
      </p>
      <div className="text-sm">
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted pb-1 border-b border-line/50">
          <span className="w-20">Line</span>
          <span className="flex-1">Best price</span>
          <span className="w-20 text-right">Hit L10</span>
          <span className="w-16 text-right">Hit L5</span>
        </div>
        {ladder.rungs.map((r) => (
          <div
            key={r.line}
            className={`flex items-center gap-3 py-1.5 border-b border-line/30 ${
              r.isLean ? "text-paper" : "text-muted"
            }`}
          >
            <span className="w-20 font-bold">
              {r.isLean && <span className="text-gold mr-1">●</span>}
              {r.lineLabel}
              {r.isLean && (
                <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-goldsoft border border-gold/40 rounded-full px-2 py-0.5">
                  the lean
                </span>
              )}
            </span>
            <span className="flex-1 text-goldsoft">{priceText(r)}</span>
            <span className="w-20 text-right">{rate(r, "l10")}</span>
            <span className="w-16 text-right">{rate(r, "l5")}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-2">Hit rates from game logs (ESPN).</p>
    </div>
  );
}
