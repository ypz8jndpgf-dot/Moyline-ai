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

function americanToProb(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function decimalToAmerican(dec: number): string {
  if (dec >= 2) return "+" + Math.round((dec - 1) * 100);
  return String(Math.round(-100 / (dec - 1)));
}

function extractLeague(game: string): string {
  const m = game.match(/\(([^)]+)\)/);
  return m ? m[1] : "Other";
}

type Leg = FeedPick & { uid: string };

type Rating = {
  score: number; // 1-5
  fairOdds: string;
  offeredOdds: string;
  edgeVerdict: string;
  feedback: string[];
  suggestion: string | null;
  unratedCount: number;
};

/** AI rating: combines per-leg edges into a ticket verdict. */
function rateTicket(legs: Leg[], pool: FeedPick[]): Rating {
  const feedback: string[] = [];
  let unratedCount = 0;
  let totalEdge = 0;
  let ratedLegs = 0;
  let combinedFairProb = 1;
  let offeredDec = 1;
  let weakest: Leg | null = null;
  let weakestEdge = Infinity;

  // Correlation check: legs from the same game
  const gameCounts = new Map<string, number>();
  for (const l of legs) {
    gameCounts.set(l.game, (gameCounts.get(l.game) || 0) + 1);
  }
  const correlatedGames = [...gameCounts.entries()].filter(([, c]) => c > 1);

  for (const leg of legs) {
    const odds = parseOdds(leg.price);
    if (odds === null) {
      unratedCount++;
      continue;
    }
    offeredDec *= americanToDecimal(odds);
    const implied = americanToProb(odds);
    const edge = leg.edge_cents ?? null;
    if (edge === null) {
      unratedCount++;
      // No edge data: assume fair (no edge either way)
      combinedFairProb *= implied;
    } else {
      ratedLegs++;
      totalEdge += edge;
      // Edge in cents ≈ probability points of edge at these odds
      const fairProb = Math.min(0.95, Math.max(0.05, implied + edge / 10000));
      combinedFairProb *= fairProb;
      if (edge < weakestEdge) {
        weakestEdge = edge;
        weakest = leg;
      }
    }
  }

  // Correlation discount: same-game legs are not independent
  if (correlatedGames.length > 0) {
    combinedFairProb *= Math.pow(0.92, correlatedGames.length);
    feedback.push(
      `⚠️ ${correlatedGames.length} same-game correlation${correlatedGames.length > 1 ? "s" : ""} detected — true odds are worse than the simple multiply suggests.`
    );
  }

  const fairDec = 1 / combinedFairProb;
  const fairOdds = decimalToAmerican(fairDec);
  const offeredOdds = decimalToAmerican(offeredDec);
  const edgeRatio = fairDec / offeredDec; // >1 means we're getting a good price

  // Score 1-5
  let score: number;
  if (unratedCount === legs.length) {
    score = 3; // No data — neutral
    feedback.push("No edge data on these legs — rating is neutral. Add card picks for a real grade.");
  } else if (edgeRatio >= 1.15) score = 5;
  else if (edgeRatio >= 1.07) score = 4;
  else if (edgeRatio >= 0.97) score = 3;
  else if (edgeRatio >= 0.9) score = 2;
  else score = 1;

  const avgEdge = ratedLegs > 0 ? Math.round(totalEdge / ratedLegs) : 0;
  let edgeVerdict: string;
  if (unratedCount === legs.length) {
    edgeVerdict = "No edge data — can't grade this ticket.";
  } else if (avgEdge >= 20) {
    edgeVerdict = `Strong ticket — averaging ~${avgEdge}¢ edge per rated leg.`;
  } else if (avgEdge >= 10) {
    edgeVerdict = `Decent ticket — averaging ~${avgEdge}¢ edge per rated leg.`;
  } else if (avgEdge >= 0) {
    edgeVerdict = `Thin ticket — averaging ~${avgEdge}¢ edge per rated leg.`;
  } else {
    edgeVerdict = `Negative edge — averaging ~${avgEdge}¢ per rated leg. The book is happy to take this.`;
  }

  if (weakest && weakestEdge < 10 && ratedLegs > 1) {
    feedback.push(`Weakest leg: "${weakest.play}" (~${weakestEdge}¢ edge). Consider swapping it.`);
  }
  if (legs.length >= 4) {
    feedback.push("4+ legs — variance is high. True probability drops fast with each added leg.");
  }
  if (unratedCount > 0 && unratedCount < legs.length) {
    feedback.push(`${unratedCount} leg${unratedCount > 1 ? "s" : ""} without edge data — graded as fair.`);
  }

  // Suggestion: best swap for the weakest leg
  let suggestion: string | null = null;
  if (weakest && pool.length > 0) {
    const usedKeys = new Set(legs.map((l) => l.game + "|" + l.play));
    const candidates = pool
      .filter((p) => !usedKeys.has(p.game + "|" + p.play))
      .filter((p) => (p.edge_cents ?? 0) > weakestEdge + 10)
      .sort((a, b) => (b.edge_cents ?? 0) - (a.edge_cents ?? 0));
    if (candidates.length > 0) {
      const best = candidates[0];
      suggestion = `Swap "${weakest.play}" for "${best.play}" (~${best.edge_cents}¢ edge) to upgrade this ticket.`;
    }
  }

  return { score, fairOdds, offeredOdds, edgeVerdict, feedback, suggestion, unratedCount };
}

const ALL_SPORTS = ["NFL", "CFB", "NBA", "NHL", "MLB", "MLS", "EPL", "La Liga", "Bundesliga", "Serie A", "Ligue 1", "Brasileirão", "UCL"];

/* ---------- slip import (steal #1: snap/paste a bet slip, get it checked) ---------- */

const slipNorm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Distinctive tokens of a pool leg: team nicknames, player surnames, line numbers. */
function legTokens(leg: FeedPick): string[] {
  const words = slipNorm(`${leg.game} ${leg.play}`).split(" ").filter((w) => w.length >= 4);
  return [...new Set(words)];
}

/**
 * Parse raw slip text (OCR output or pasted) into legs. Lines that match a
 * pool leg inherit its edge rating; the rest become unrated custom legs —
 * the verdict flags those honestly instead of pretending to grade them.
 */
function parseSlip(text: string, pool: Leg[]): { legs: Leg[]; matched: number } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 4)
    .filter((l) => !/^(parlay|sgp|bet slip|wager|to win|potential payout|odds boost|total odds)/i.test(l));
  const out: Leg[] = [];
  let matched = 0;
  for (const line of lines) {
    const oddsM = line.match(/([+-]\d{3,4})/);
    const lineTokens = new Set(slipNorm(line).split(" ").filter((w) => w.length >= 4));
    let best: Leg | null = null;
    let bestScore = 0;
    for (const leg of pool) {
      const toks = legTokens(leg);
      if (toks.length === 0) continue;
      const hits = toks.filter((t) => lineTokens.has(t)).length;
      const score = hits / toks.length;
      // Require the leg's most distinctive token (a nickname/surname) to appear.
      if (hits >= 2 && score > bestScore) {
        best = leg;
        bestScore = score;
      }
    }
    if (best && bestScore >= 0.34) {
      matched++;
      out.push({ ...best, uid: `slip-${Date.now()}-${out.length}` });
    } else if (oddsM) {
      out.push({
        game: "From your slip",
        play: line.replace(/\s*\(?([+-]\d{3,4})\)?\s*$/, "").slice(0, 90) || line.slice(0, 90),
        price: oddsM[1],
        confidence: 0,
        uid: `slip-${Date.now()}-${out.length}`,
      } as Leg);
    }
    if (out.length >= 8) break;
  }
  return { legs: out, matched };
}

/** Load tesseract.js (UMD) from CDN on demand for in-browser OCR. */
async function loadTesseract(): Promise<any> {
  const w = window as any;
  if (w.Tesseract) return w.Tesseract;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("ocr-load"));
    document.head.appendChild(s);
  });
  return (window as any).Tesseract;
}

export default function TicketBuilder({
  picks,
  props,
  backpage,
  boardLegs = [],
}: {
  picks: FeedPick[];
  props: FeedPick[];
  backpage: FeedPick[];
  boardLegs?: FeedPick[];
}) {
  const [ticket, setTicket] = useState<Leg[]>([]);
  const [sportFilter, setSportFilter] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [slipText, setSlipText] = useState("");
  const [slipBusy, setSlipBusy] = useState(false);
  const [slipNote, setSlipNote] = useState<string | null>(null);

  const pool: Leg[] = useMemo(() => {
    // Card picks first (rated), then board games (unrated — AI flags them).
    // Dedupe: skip board legs that match a card pick's game+play.
    const cardKeys = new Set(
      [...picks, ...props, ...backpage].map((p) => `${p.game}|${p.play}`)
    );
    const all = [
      ...picks,
      ...props,
      ...backpage,
      ...boardLegs.filter((b) => !cardKeys.has(`${b.game}|${b.play}`)),
    ];
    return all.map((p, i) => ({ ...p, uid: `pool-${i}` }));
  }, [picks, props, backpage, boardLegs]);

  const filtered = useMemo(() => {
    return pool.filter((p) => {
      if (sportFilter !== "All" && extractLeague(p.game) !== sportFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(p.game.toLowerCase().includes(q) || p.play.toLowerCase().includes(q))) return false;
      }
      // Don't show legs already in ticket
      if (ticket.some((t) => t.game === p.game && t.play === p.play)) return false;
      return true;
    });
  }, [pool, sportFilter, search, ticket]);

  const rating = useMemo(
    () => (ticket.length >= 2 ? rateTicket(ticket, pool) : null),
    [ticket, pool]
  );

  const addLeg = (p: Leg) => {
    if (ticket.length >= 8) return;
    setTicket([...ticket, { ...p, uid: `ticket-${Date.now()}-${Math.random()}` }]);
  };

  const importSlip = (text: string) => {
    const { legs, matched } = parseSlip(text, pool);
    if (legs.length === 0) {
      setSlipNote("Couldn't find any legs in that — try a clearer photo, or paste the slip text.");
      return;
    }
    const fresh = legs.filter(
      (l) => !ticket.some((t) => t.game === l.game && t.play === l.play)
    );
    setTicket([...ticket, ...fresh].slice(0, 8));
    setSlipNote(
      `Imported ${fresh.length} leg${fresh.length === 1 ? "" : "s"} — ${matched} matched to rated legs, ${fresh.length - matched} unrated (graded as fair). Check each leg below; tap × to remove anything wrong.`
    );
  };

  const onSlipPhoto = async (file: File | undefined) => {
    if (!file) return;
    setSlipBusy(true);
    setSlipNote("Reading your slip…");
    try {
      const T = await loadTesseract();
      const { data } = await T.recognize(file, "eng");
      const text = (data?.text || "").trim();
      if (!text) throw new Error("ocr-empty");
      setSlipText(text);
      importSlip(text);
    } catch {
      setSlipNote("Couldn't read that photo. Paste the slip text below instead — same check.");
    }
    setSlipBusy(false);
  };

  const removeLeg = (uid: string) => setTicket(ticket.filter((t) => t.uid !== uid));

  const sportsInPool = useMemo(() => {
    // Show ALL sports in the filter — not just ones with card picks today.
    // Sports with no legs yet show an empty state when selected.
    return ["All", ...ALL_SPORTS];
  }, []);

  return (
    <div>
      {/* Slip check (steal #1): snap a photo or paste the text of a slip
          from any book and the builder grades it with the same verdict. */}
      <div className="card p-4 mb-4">
        <h3 className="font-display text-lg mb-1">📸 CHECK YOUR SLIP</h3>
        <p className="text-xs text-muted mb-3">
          Already have a ticket somewhere else? Snap it or paste it — we&apos;ll
          match the legs to our rated card and grade the whole thing.
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <label className={`btn-gold px-4 py-2 text-sm cursor-pointer ${slipBusy ? "opacity-50 pointer-events-none" : ""}`}>
            {slipBusy ? "Reading…" : "📷 Upload slip photo"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onSlipPhoto(e.target.files?.[0])}
            />
          </label>
          <span className="text-xs text-muted">or paste the slip text:</span>
        </div>
        <textarea
          value={slipText}
          onChange={(e) => setSlipText(e.target.value)}
          rows={3}
          placeholder={"e.g.\nLakers -3.5 (-110)\nJayson Tatum Over 27.5 points (-115)"}
          className="w-full px-3 py-2 rounded bg-white/5 border border-white/10 text-sm mb-2"
        />
        <button
          type="button"
          disabled={slipBusy || slipText.trim().length < 4}
          onClick={() => importSlip(slipText)}
          className="btn-gold px-5 py-2 text-sm disabled:opacity-50"
        >
          Check this slip
        </button>
        {slipNote && <p className="text-xs text-muted mt-2">{slipNote}</p>}
      </div>

    <div className="grid md:grid-cols-2 gap-4">
      {/* Left: leg picker */}
      <div>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="Search teams, players..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 rounded bg-white/5 border border-white/10 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-3">
          {sportsInPool.map((s) => (
            <button
              key={s}
              onClick={() => setSportFilter(s)}
              className={`px-3 py-2 sm:px-2.5 sm:py-1 rounded-full text-xs font-bold min-h-[36px] sm:min-h-0 inline-flex items-center ${
                sportFilter === s ? "bg-gold text-black" : "bg-white/5 text-muted hover:text-white"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
          {filtered.length === 0 && (
            <p className="text-sm text-muted text-center py-8">No legs match — try a different search.</p>
          )}
          {filtered.map((p) => (
            <button
              key={p.uid}
              onClick={() => addLeg(p)}
              className="card p-3 w-full text-left hover:border-gold/50 transition-colors"
            >
              <p className="text-xs text-muted">{p.game}</p>
              <p className="text-sm font-bold">
                {p.play} <span className="text-goldsoft">{p.price}</span>
              </p>
              <div className="flex gap-2 mt-1">
                <span className="text-xs text-muted">Conf {p.confidence}/5</span>
                {p.edge_cents != null && p.edge_cents > 0 && (
                  <span className="text-xs text-up">+{p.edge_cents}¢ edge</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: bet slip + AI rating */}
      <div>
        <div className="card p-4 sticky top-4">
          <h3 className="font-display text-xl mb-3">YOUR TICKET {ticket.length > 0 && `(${ticket.length})`}</h3>
          {ticket.length === 0 ? (
            <p className="text-sm text-muted text-center py-6">
              Tap legs on the left to build your ticket.
            </p>
          ) : (
            <>
              <div className="space-y-2 mb-4">
                {ticket.map((t) => (
                  <div key={t.uid} className="flex items-start justify-between bg-white/5 rounded p-2.5">
                    <div>
                      <p className="text-xs text-muted">{t.game}</p>
                      <p className="text-sm font-bold">{t.play} <span className="text-goldsoft">{t.price}</span></p>
                    </div>
                    <button
                      onClick={() => removeLeg(t.uid)}
                      className="text-muted hover:text-down text-lg leading-none px-1"
                      aria-label="Remove leg"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {rating && (
                <div className="border-t border-white/10 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold">AI VERDICT</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div
                          key={i}
                          className={`w-6 h-2.5 rounded-full ${i <= rating.score ? "bg-gold" : "bg-white/10"}`}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-2xl font-display mb-1">
                    {rating.score}/5
                  </p>
                  <p className="text-sm text-muted mb-2">{rating.edgeVerdict}</p>
                  <p className="text-xs text-muted mb-3">
                    Fair odds ~{rating.fairOdds} · Offered {rating.offeredOdds}
                  </p>
                  {rating.feedback.map((f, i) => (
                    <p key={i} className="text-xs text-muted mb-1.5">{f}</p>
                  ))}
                  {rating.suggestion && (
                    <div className="mt-3 p-2.5 rounded bg-gold/10 border border-gold/30">
                      <p className="text-xs font-bold text-goldsoft mb-1">💡 SUGGESTION</p>
                      <p className="text-xs">{rating.suggestion}</p>
                    </div>
                  )}
                </div>
              )}
              {ticket.length === 1 && (
                <p className="text-xs text-muted text-center mt-2">Add at least one more leg for an AI verdict.</p>
              )}
              {ticket.length > 0 && (
                <button
                  onClick={() => setTicket([])}
                  className="text-xs text-muted hover:text-white mt-3 w-full text-center"
                >
                  Clear ticket
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
