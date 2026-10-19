"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = {
  handle: string;
  w: number;
  l: number;
  p: number;
  pending: number;
  total: number;
  pct: number | null;
};

const MEDALS = ["🥇", "🥈", "🥉"];

export default function LeaderboardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((d) => {
        setRows(d.leaderboard || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const ranked = rows.filter((r) => r.w + r.l >= 3);
  const unranked = rows.filter((r) => r.w + r.l < 3);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full border border-gold/40 bg-gold/10 text-gold text-[11px] font-bold uppercase tracking-[0.2em]">
          <span>🏆</span> Leaderboard
        </div>
        <h1 className="font-display text-4xl sm:text-5xl">
          WHO'S <span className="gold-text">HOTTEST?</span>
        </h1>
        <p className="text-muted mt-2 text-sm max-w-xl mx-auto">
          Beta members ranked by their tailed picks. Min 3 graded picks to rank.
          Handles are anonymized.
        </p>
      </div>

      {loading ? (
        <div className="card p-8 text-center">
          <div className="flex gap-1.5 justify-center">
            {[0, 1, 2].map((d) => (
              <div
                key={d}
                className="w-2 h-2 rounded-full bg-gold animate-bounce"
                style={{ animationDelay: `${d * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      ) : ranked.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg mb-2">No ranked players yet.</p>
          <p className="text-sm text-muted mb-6">
            Tail at least 3 picks to hit the board.
          </p>
          <Link href="/picks" className="btn-gold px-6 py-2 inline-block">
            View today's card
          </Link>
        </div>
      ) : (
        <div className="card p-4 sm:p-6">
          <div className="space-y-2">
            {ranked.map((r, i) => (
              <div
                key={r.handle}
                className={`flex items-center gap-3 p-3 rounded-xl border ${
                  i === 0
                    ? "border-gold/50 bg-gold/10"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div className="w-8 text-center text-xl shrink-0">
                  {MEDALS[i] || <span className="text-muted text-sm font-bold">#{i + 1}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{r.handle}</p>
                  <p className="text-[11px] text-muted">
                    {r.total} tailed · {r.pending > 0 ? `${r.pending} pending` : "all graded"}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-display text-lg">
                    <span className="text-emerald-400">{r.w}</span>
                    <span className="text-muted">-</span>
                    <span className="text-red-400">{r.l}</span>
                    {r.p > 0 && <span className="text-muted text-sm">-{r.p}</span>}
                  </p>
                  {r.pct !== null && (
                    <p className="text-xs text-gold font-bold">
                      {(r.pct * 100).toFixed(0)}%
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {unranked.length > 0 && (
            <p className="text-[11px] text-muted/60 text-center mt-4">
              {unranked.length} more player{unranked.length > 1 ? "s" : ""} building
              their record ({unranked.map((r) => r.handle).join(", ")})
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted/50 text-center mt-4">
        Ranked on graded tailed picks only. Updates as games are graded.
      </p>
    </div>
  );
}
