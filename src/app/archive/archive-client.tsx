"use client";

import { useState } from "react";
import type { ArchivePick } from "@/lib/picks";

export type DayGroup = {
  date: string;
  label: string;
  picks: ArchivePick[];
  wins: number;
  losses: number;
  pushes: number;
};

function sportOf(p: ArchivePick): string {
  if (p.sport) return p.sport.toUpperCase();
  const m = p.game.match(/\(([^)]+)\)\s*$/);
  return m ? m[1].toUpperCase() : "OTHER";
}

function ResultBadge({ result }: { result: "win" | "loss" | "push" }) {
  if (result === "win")
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-extrabold bg-up/15 text-up border border-up/40">
        W
      </span>
    );
  if (result === "loss")
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-extrabold bg-down/15 text-down border border-down/40">
        L
      </span>
    );
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-extrabold bg-white/10 text-muted border border-line">
      PUSH
    </span>
  );
}

export default function ArchiveClient({
  groups,
  sports,
}: {
  groups: DayGroup[];
  sports: string[];
}) {
  const [filter, setFilter] = useState<string>("ALL");

  const visible = groups
    .map((g) => ({
      ...g,
      picks: g.picks.filter((p) => filter === "ALL" || sportOf(p) === filter),
    }))
    .filter((g) => g.picks.length > 0);

  return (
    <div>
      {sports.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {["ALL", ...sports].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                filter === s
                  ? "bg-gold text-ink border-gold"
                  : "border-line text-muted hover:border-gold/60 hover:text-gold"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 && (
        <p className="text-muted text-sm">No picks for this filter yet.</p>
      )}

      {visible.map((g) => (
        <article key={g.date} className="mb-8">
          <div className="flex items-baseline justify-between mb-3">
            <time
              dateTime={g.date}
              className="font-display text-lg text-paper"
            >
              {g.label}
            </time>
            <span className="text-xs text-muted font-bold">
              <span className="text-up">{g.wins}W</span>
              {" - "}
              <span className="text-down">{g.losses}L</span>
              {g.pushes > 0 && (
                <>
                  {" - "}
                  <span>{g.pushes}P</span>
                </>
              )}
            </span>
          </div>
          <div className="space-y-2">
            {g.picks.map((p, i) => (
              <div
                key={`${p.game}-${p.play}-${i}`}
                className="card p-3 sm:p-4 flex items-start gap-3"
              >
                <div className="pt-0.5 shrink-0">
                  <ResultBadge result={p.result} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-bold text-sm text-paper">
                      {p.game}
                    </span>
                    {p.star && (
                      <span className="text-gold text-sm" title="Star pick">
                        ★
                      </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-line text-muted font-bold">
                      {sportOf(p)}
                    </span>
                  </div>
                  <div className="text-sm mt-0.5">
                    <span className="text-goldsoft font-bold">{p.play}</span>
                    <span className="text-muted"> {p.price}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
