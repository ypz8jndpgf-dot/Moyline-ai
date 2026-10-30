"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CheatLeg, CheatSheet, Split } from "@/lib/cheatsheet";

type Basis = "l10" | "l5" | "vsOpp" | "venue";

const BASIS_LABEL: Record<Basis, string> = {
  l10: "Recent form (L10)",
  l5: "Hot streak (L5)",
  vsOpp: "vs this opponent",
  venue: "Home/away split",
};

const SEED_KEY = "moyline:builder:seed";

function pct(s: Split): string {
  return s.n ? `${Math.round((s.hits / s.n) * 100)}%` : "—";
}

function basisSplit(leg: CheatLeg, basis: Basis): { split: Split; fallback: boolean } {
  if (basis === "l10") return { split: leg.splits.l10, fallback: false };
  if (basis === "l5") return { split: leg.splits.l5, fallback: false };
  const s = basis === "vsOpp" ? leg.splits.vsOpp : leg.splits.venue;
  if (s && s.n > 0) return { split: s, fallback: false };
  return { split: leg.splits.l10, fallback: true };
}

export default function CheatsheetBuilder() {
  const [sheet, setSheet] = useState<CheatSheet | null>(null);
  const [failed, setFailed] = useState(false);
  const [direction, setDirection] = useState<"all" | "over" | "under">("all");
  const [market, setMarket] = useState<string>("All");
  const [game, setGame] = useState<string>("All");
  const [basis, setBasis] = useState<Basis>("l10");
  const [openId, setOpenId] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    fetch("/api/cheatsheet")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
      .then((d) => {
        if (live) setSheet(d as CheatSheet);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const markets = useMemo(
    () => ["All", ...new Set((sheet?.legs || []).map((l) => l.marketLabel))],
    [sheet]
  );
  const games = useMemo(
    () => ["All", ...new Set((sheet?.legs || []).map((l) => l.game))],
    [sheet]
  );

  const legs = useMemo(() => {
    const all = sheet?.legs || [];
    const filtered = all.filter((l) => {
      if (direction !== "all" && l.direction !== direction) return false;
      if (market !== "All" && l.marketLabel !== market) return false;
      if (game !== "All" && l.game !== game) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      const sa = basisSplit(a, basis).split;
      const sb = basisSplit(b, basis).split;
      const ra = sa.n ? sa.hits / sa.n : 0;
      const rb = sb.n ? sb.hits / sb.n : 0;
      return rb - ra || sb.n - sa.n;
    });
  }, [sheet, direction, market, game, basis]);

  const addToTicket = (leg: CheatLeg) => {
    try {
      const raw = localStorage.getItem(SEED_KEY);
      const seed: { game: string; play: string; price: string }[] = raw ? JSON.parse(raw) : [];
      if (!seed.some((s) => s.game === leg.game && s.play === leg.play)) {
        seed.push({ game: leg.game, play: leg.play, price: leg.price });
        localStorage.setItem(SEED_KEY, JSON.stringify(seed.slice(-8)));
      }
    } catch {
      // Private mode etc. — the button still records the add for this view.
    }
    setAdded((prev) => new Set(prev).add(leg.id));
  };

  const pill = (active: boolean) =>
    `px-4 py-2.5 sm:px-3 sm:py-1.5 rounded-full text-sm font-bold border transition min-h-[44px] sm:min-h-0 inline-flex items-center justify-center ${
      active
        ? "bg-gold text-ink border-gold"
        : "border-line text-muted hover:text-paper hover:border-gold/50"
    }`;

  if (failed) {
    return (
      <div className="card p-8 text-center">
        <p className="text-lg mb-2">Couldn&apos;t build today&apos;s cheatsheet.</p>
        <p className="text-sm text-muted">Game-log data didn&apos;t come back — try again in a bit, or use Ticket Lab mode above.</p>
      </div>
    );
  }
  if (!sheet) {
    return (
      <div className="card p-8 text-center">
        <p className="text-lg mb-2">📋 Building your cheatsheet…</p>
        <p className="text-sm text-muted">
          Pulling real game logs for today&apos;s prop board. The first build of the day can take a few seconds — after that it&apos;s cached.
        </p>
      </div>
    );
  }
  if (sheet.poolSize === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-lg mb-2">No props on today&apos;s board yet.</p>
        <p className="text-sm text-muted">The cheatsheet builds from the brief&apos;s researched props — check back after the next edition posts.</p>
      </div>
    );
  }
  if (sheet.legs.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-lg mb-2">No hit-rate data for today&apos;s props.</p>
        <p className="text-sm text-muted">
          {sheet.poolSize} prop{sheet.poolSize === 1 ? "" : "s"} on the board, but none matched a verifiable game log — we don&apos;t publish rates we can&apos;t tie out. Ticket Lab mode above still has the full card.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* wizard */}
      <div className="card p-5 mb-6">
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted mb-2">1 · What are you looking for?</p>
          <div className="flex gap-2">
            <button className={pill(direction === "all")} onClick={() => setDirection("all")}>All</button>
            <button className={pill(direction === "over")} onClick={() => setDirection("over")}>Overs</button>
            <button className={pill(direction === "under")} onClick={() => setDirection("under")}>Unders</button>
          </div>
        </div>
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted mb-2">2 · Which props?</p>
          <div className="flex flex-wrap gap-2">
            {markets.map((m) => (
              <button key={m} className={pill(market === m)} onClick={() => setMarket(m)}>{m}</button>
            ))}
          </div>
        </div>
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted mb-2">3 · Which games?</p>
          <div className="flex flex-wrap gap-2">
            {games.map((g) => (
              <button key={g} className={pill(game === g)} onClick={() => setGame(g)}>
                {g === "All" ? "All games" : g.replace(/\s*\([^)]*\)\s*$/, "")}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted mb-2">4 · Rank by</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(BASIS_LABEL) as Basis[]).map((b) => (
              <button key={b} className={pill(basis === b)} onClick={() => setBasis(b)}>
                {BASIS_LABEL[b]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-sm text-muted mb-4">
        <span className="text-paper font-bold">{legs.length}</span> leg{legs.length === 1 ? "" : "s"} · ranked by{" "}
        {BASIS_LABEL[basis].toLowerCase()} · hit rates from actual game logs ({sheet.covered} of {sheet.poolSize} conf-3+ props covered today)
      </p>

      {legs.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg mb-2">No legs match that shape.</p>
          <p className="text-sm text-muted">Loosen a filter — different direction, prop type, or game.</p>
        </div>
      ) : (
        <ul className="space-y-3 mb-6">
          {legs.map((leg) => {
            const { split, fallback } = basisSplit(leg, basis);
            const open = openId === leg.id;
            const isAdded = added.has(leg.id);
            return (
              <li key={leg.id} className="card p-4">
                <div className="flex items-start gap-4">
                  <div className="text-center shrink-0 w-16">
                    <p className="font-display text-2xl text-gold leading-none">
                      {split.hits}/{split.n}
                    </p>
                    <p className="text-xs text-muted mt-1">{pct(split)} hit rate</p>
                    {fallback && <p className="text-[10px] text-muted">L10 — no split data</p>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold">
                      {leg.player}{" "}
                      <span className="text-xs font-normal text-muted">
                        {leg.team} · {leg.marketLabel}
                      </span>
                      {leg.streak >= 3 && (
                        <span className="ml-2 text-xs font-bold text-gold">🔥 {leg.streak} straight</span>
                      )}
                    </p>
                    <p className="text-sm text-muted">
                      {leg.play} <span className="text-goldsoft">{leg.price}</span>
                    </p>
                    <p className="text-xs text-muted">
                      {leg.game}
                      {leg.starts && <span> · 🕐 {leg.starts}</span>} · avg {leg.avg10} over last {Math.min(10, leg.rows.length)}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        className={pill(isAdded)}
                        onClick={() => !isAdded && addToTicket(leg)}
                      >
                        {isAdded ? "✓ Added to ticket" : "＋ Add to ticket"}
                      </button>
                      <button className={pill(false)} onClick={() => setOpenId(open ? null : leg.id)}>
                        {open ? "Hide trend" : "Trend analysis"}
                      </button>
                    </div>
                  </div>
                </div>
                {open && (
                  <div className="mt-4 pt-4 border-t border-line/50">
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted mb-3">
                      <span>L5 <b className="text-paper">{leg.splits.l5.hits}/{leg.splits.l5.n}</b></span>
                      <span>L10 <b className="text-paper">{leg.splits.l10.hits}/{leg.splits.l10.n}</b></span>
                      <span>Window <b className="text-paper">{leg.splits.all.hits}/{leg.splits.all.n}</b></span>
                      {leg.splits.vsOpp && (
                        <span>vs Opp <b className="text-paper">{leg.splits.vsOpp.hits}/{leg.splits.vsOpp.n}</b></span>
                      )}
                      {leg.splits.venue && (
                        <span>{leg.rows[0] && leg.splits.venue ? "Home/Away" : ""} split <b className="text-paper">{leg.splits.venue.hits}/{leg.splits.venue.n}</b></span>
                      )}
                    </div>
                    <ul className="text-sm space-y-1">
                      {leg.rows.map((r, i) => (
                        <li key={i} className="flex items-center gap-3">
                          <span className="w-20 text-muted text-xs">{r.date}</span>
                          <span className="w-16 text-xs">{r.home ? "vs" : "@"} {r.opp}</span>
                          <span className="font-bold w-10">{r.value}</span>
                          <span>{r.result === "hit" ? "✅" : r.result === "push" ? "➖ push" : "❌"}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted mt-3">
                      Line tested: {leg.direction === "over" ? "Over" : "Under"} {leg.lineLabel} · pushes don&apos;t count in the rate.
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {added.size > 0 && (
        <div className="card card-glow p-4 mb-6 flex items-center justify-between gap-3">
          <p className="text-sm">
            <b>{added.size}</b> leg{added.size === 1 ? "" : "s"} on your ticket.
          </p>
          <Link href="/builder" className="btn-gold px-5 py-2.5 font-bold text-sm inline-block">
            Grade it in Ticket Builder →
          </Link>
        </div>
      )}

      <p className="text-xs text-muted">
        Hit rates computed from actual ESPN box scores over each player&apos;s last 12 games. A high hit
        rate isn&apos;t an edge by itself — price still matters, and the graded MoyLine card runs on
        price vs fair line. Analysis for entertainment purposes — not financial advice.
      </p>
    </div>
  );
}
