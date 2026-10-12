"use client";

import { useEffect, useState } from "react";

/**
 * Animated promo demo: auto-plays a loop showing a ticket being built
 * leg-by-leg, the AI meter filling, and a suggestion appearing.
 * Pure CSS/React — no video file needed.
 */

const DEMO_LEGS = [
  { game: "Ravens @ Falcons (NFL)", play: "Brian Robinson Jr. anytime TD", price: "+240" },
  { game: "Dodgers @ Brewers (MLB)", play: "Brewers ML", price: "-106" },
  { game: "Ravens @ Falcons (NFL)", play: "Derrick Henry anytime TD", price: "-165" },
];

const PHASES = [0, 1, 2, 3, 4]; // 0-2: legs appear, 3: meter, 4: suggestion

export default function BuilderPromo({ legCount }: { legCount: number }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setPhase((p) => (p + 1) % PHASES.length);
    }, 1600);
    return () => clearInterval(t);
  }, []);

  const visibleLegs = DEMO_LEGS.slice(0, Math.min(phase + 1, 3));
  const showMeter = phase >= 3;
  const showSuggestion = phase >= 4;

  return (
    <div className="card p-5 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-gold via-goldsoft to-gold" />
      <p className="text-xs font-bold uppercase tracking-widest text-goldsoft mb-3 text-center">
        ▶ Watch it work
      </p>

      {/* Demo ticket */}
      <div className="space-y-2 mb-4 min-h-[132px]">
        {visibleLegs.map((l, i) => (
          <div
            key={i}
            className="flex items-center justify-between bg-white/5 rounded p-2.5 animate-[fadeSlideIn_0.4s_ease-out]"
          >
            <div>
              <p className="text-xs text-muted">{l.game}</p>
              <p className="text-sm font-bold">{l.play}</p>
            </div>
            <span className="text-sm font-bold text-goldsoft">{l.price}</span>
          </div>
        ))}
        {visibleLegs.length < 3 && (
          <div className="border border-dashed border-white/15 rounded p-2.5 text-center">
            <p className="text-xs text-muted">+ tap a leg to add it…</p>
          </div>
        )}
      </div>

      {/* AI meter */}
      <div className={`transition-opacity duration-500 ${showMeter ? "opacity-100" : "opacity-30"}`}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold">AI VERDICT</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`w-7 h-3 rounded-full transition-colors duration-500 ${
                  showMeter && i <= 4 ? "bg-gold" : "bg-white/10"
                }`}
                style={{ transitionDelay: showMeter ? `${i * 120}ms` : "0ms" }}
              />
            ))}
          </div>
        </div>
        <p className="text-xl font-display">
          {showMeter ? "4/5" : "–/5"}
        </p>
        <p className="text-xs text-muted">
          {showMeter ? "Strong ticket — averaging ~22¢ edge per leg." : "Add 2+ legs for a verdict…"}
        </p>
      </div>

      {/* Suggestion */}
      <div
        className={`mt-3 p-2.5 rounded bg-gold/10 border border-gold/30 transition-all duration-500 ${
          showSuggestion ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
        }`}
      >
        <p className="text-xs font-bold text-goldsoft mb-1">💡 SUGGESTION</p>
        <p className="text-xs">Swap the weakest leg for a +30¢ edge play to hit 5/5.</p>
      </div>

      <p className="text-center text-xs text-muted mt-4">
        {legCount > 0 ? (
          <>{legCount} legs on the board right now — yours to combine.</>
        ) : (
          <>Every card pick, prop & Undercard lean — yours to combine.</>
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
