"use client";

import { useEffect, useState } from "react";

/**
 * Animated promo demo for Parlay Lab: auto-plays a loop showing the Lab
 * assembling a ticket — controls set, legs appearing one by one,
 * combined odds calculating.
 * Pure CSS/React — no video file needed.
 */

const DEMO_LEGS = [
  { game: "Ravens @ Falcons (NFL)", play: "Drake London anytime TD", price: "+125", edge: "+18¢" },
  { game: "Ravens @ Falcons (NFL)", play: "Bijan Robinson over 119.5 rush+rec yds", price: "-115", edge: "+24¢" },
  { game: "Dodgers @ Brewers (MLB)", play: "Brewers ML", price: "-106", edge: "+21¢" },
];

const PHASES = [0, 1, 2, 3, 4, 5]; // 0: controls, 1-3: legs, 4: odds, 5: hold

export default function LabPromo({ legCount }: { legCount: number }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setPhase((p) => (p + 1) % PHASES.length);
    }, 1500);
    return () => clearInterval(t);
  }, []);

  const visibleLegs = DEMO_LEGS.slice(0, Math.max(0, Math.min(phase, 3)));
  const showOdds = phase >= 4;

  return (
    <div className="card p-5 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-gold via-goldsoft to-gold" />
      <p className="text-xs font-bold uppercase tracking-widest text-goldsoft mb-3 text-center">
        ▶ Watch it work
      </p>

      {/* Demo controls */}
      <div className="flex flex-wrap gap-2 justify-center mb-4">
        <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-gold text-black">
          Parlay
        </span>
        <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-gold text-black">
          3 legs
        </span>
        <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-gold text-black">
          All sports
        </span>
      </div>
      <p className="text-xs text-muted text-center mb-3 -mt-2">
        You set the shape — the Lab finds the edges.
      </p>

      {/* Assembled ticket */}
      <div className="space-y-2 mb-4 min-h-[156px]">
        {visibleLegs.map((l, i) => (
          <div
            key={i}
            className="flex items-center justify-between bg-white/5 rounded p-2.5 animate-[fadeSlideIn_0.4s_ease-out]"
          >
            <div>
              <p className="text-xs text-muted">{l.game}</p>
              <p className="text-sm font-bold">{l.play}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-goldsoft">{l.price}</p>
              <p className="text-xs text-up">{l.edge} edge</p>
            </div>
          </div>
        ))}
        {visibleLegs.length < 3 && (
          <div className="border border-dashed border-white/15 rounded p-2.5 text-center">
            <p className="text-xs text-muted">⚗️ Lab assembling highest-edge combo…</p>
          </div>
        )}
      </div>

      {/* Combined odds */}
      <div
        className={`text-center border-t border-white/10 pt-3 transition-all duration-500 ${
          showOdds ? "opacity-100" : "opacity-30"
        }`}
      >
        <p className="text-xs text-muted mb-1">Combined odds</p>
        <p className="font-display text-3xl text-goldsoft">
          {showOdds ? "+612" : "···"}
        </p>
        <p className="text-xs text-muted mt-1">
          {showOdds ? "True math. No boosted-odds tricks." : "Calculating…"}
        </p>
      </div>

      <p className="text-center text-xs text-muted mt-4">
        {legCount > 0 ? (
          <>{legCount} eligible legs on the board right now.</>
        ) : (
          <>Card picks + player props, assembled for you.</>
        )}
      </p>

      <style jsx>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
