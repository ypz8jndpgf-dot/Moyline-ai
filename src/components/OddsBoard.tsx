"use client";

import { useMemo, useState } from "react";
import type { GameVM, MoverVM, CellVM, BookVM } from "@/lib/board";
import { SPORT_LABELS } from "@/lib/odds-shared";

function DeltaBadge({ cell }: { cell: CellVM }) {
  if (!cell.moved) return null;
  const parts: string[] = [];
  if (cell.pointDelta !== undefined && cell.pointDelta !== 0) {
    const arrow = cell.pointDelta > 0 ? "▲" : "▼";
    const color = cell.pointDelta > 0 ? "text-up" : "text-down";
    parts.push(`${arrow}`);
    return (
      <span className={`ml-1 text-[11px] font-bold ${color}`}>
        {arrow} {Math.abs(cell.pointDelta)}
      </span>
    );
  }
  if (cell.priceDelta !== undefined && cell.priceDelta !== 0) {
    const arrow = cell.priceDelta > 0 ? "▲" : "▼";
    const color = cell.priceDelta > 0 ? "text-up" : "text-down";
    return (
      <span className={`ml-1 text-[11px] font-bold ${color}`}>
        {arrow} {Math.abs(cell.priceDelta)}¢
      </span>
    );
  }
  return null;
}

function SideCell({ cell }: { cell: CellVM | null }) {
  if (!cell) return <div className="py-1.5 text-muted/40 text-[11px]">—</div>;
  return (
    <div
      className={`py-1.5 px-1 text-[12px] whitespace-nowrap rounded ${
        cell.steam ? "steam-flash" : ""
      } ${cell.best ? "best-price" : ""}`}
    >
      {cell.display}
      <DeltaBadge cell={cell} />
    </div>
  );
}

const SHORT_BOOK: Record<string, string> = {
  DraftKings: "DK",
  FanDuel: "FD",
  BetMGM: "MGM",
  Caesars: "CZR",
};

const MARKET_ROWS: { label: string; tag: string; get: (b: BookVM) => CellVM | null }[] = [
  { label: "Spread", tag: "A", get: (b) => b.spreadAway },
  { label: "Spread", tag: "H", get: (b) => b.spreadHome },
  { label: "Total", tag: "O", get: (b) => b.totalOver },
  { label: "Total", tag: "U", get: (b) => b.totalUnder },
  { label: "ML", tag: "A", get: (b) => b.mlAway },
  { label: "ML", tag: "H", get: (b) => b.mlHome },
];

function GameCard({ game }: { game: GameVM }) {
  const kickoff = new Date(game.commence);
  const timeStr = kickoff.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return (
    <div className="card card-glow p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="inline-block text-[10px] font-bold uppercase tracking-widest text-gold bg-gold/10 border border-gold/30 rounded px-2 py-0.5 mr-2">
            {game.sportLabel}
          </span>
          <span className="text-xs text-muted">{timeStr} ET</span>
          {game.steamCount > 0 && (
            <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-down">
              🔥 {game.steamCount} steam
            </span>
          )}
        </div>
      </div>
      <h3 className="font-display text-lg mb-3">
        {game.away} <span className="text-muted">@</span> {game.home}
      </h3>
      {/* Books side by side: columns = books, rows = markets */}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-muted">
              <th className="text-left py-1 pr-2 w-14"></th>
              {game.books.map((b) => (
                <th
                  key={b.key}
                  className="text-left py-1 pr-2 font-bold text-goldsoft text-[11px] whitespace-nowrap"
                >
                  {SHORT_BOOK[b.label] || b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MARKET_ROWS.map((row, ri) => (
              <tr key={ri} className="border-t border-line/60">
                <td className="py-1 pr-2 text-[10px] uppercase tracking-widest text-muted whitespace-nowrap">
                  {row.label} <span className="text-paper font-bold">{row.tag}</span>
                </td>
                {game.books.map((b) => (
                  <td key={b.key} className="pr-2">
                    <SideCell cell={row.get(b)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function OddsBoard({
  games,
  movers,
  sports,
  updatedAt,
  quotaNote,
}: {
  games: GameVM[];
  movers: MoverVM[];
  sports: string[];
  updatedAt: string;
  quotaNote?: string;
}) {
  const [tab, setTab] = useState<string>("all");

  const filtered = useMemo(
    () => (tab === "all" ? games : games.filter((g) => g.sport === tab)),
    [tab, games]
  );

  const updated = updatedAt ? new Date(updatedAt).toLocaleString("en-US", { timeZone: "America/New_York" }) : "—";

  return (
    <div>
      {/* Biggest movers strip */}
      {movers.length > 0 && (
        <div className="mb-6">
          <h2 className="font-display text-sm uppercase tracking-widest text-gold mb-2">
            ⚡ Biggest movers
          </h2>
          <div className="card overflow-hidden">
            <div className="ticker py-2.5 px-4 text-[13px]">
              {[...movers, ...movers].map((m, i) => (
                <span key={i} className="inline-flex items-center gap-2">
                  <span className="text-muted text-[11px] uppercase">{m.sport}</span>
                  <span className="font-bold">{m.game}</span>
                  <span className={m.steam ? "text-down font-bold" : "text-goldsoft"}>{m.label}</span>
                  <span className="text-muted text-[11px]">{m.detail}</span>
                  <span className="text-gold mx-2">◆</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* League tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => setTab("all")}
          className={`px-4 py-1.5 rounded-full text-sm font-bold ${
            tab === "all" ? "btn-gold" : "btn-ghost"
          }`}
        >
          All
        </button>
        {sports.map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`px-4 py-1.5 rounded-full text-sm font-bold ${
              tab === s ? "btn-gold" : "btn-ghost"
            }`}
          >
            {SPORT_LABELS[s] || s}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted mb-4">
        Updated {updated} ET · <span className="text-green-400 font-bold">green cell</span> = best price · ▲▼ = move from open · 🔥 = steam move
        {quotaNote && <span className="text-down"> · {quotaNote}</span>}
      </p>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-muted">
          No games with posted lines right now. Check back closer to game time.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((g) => (
            <GameCard key={g.id} game={g} />
          ))}
        </div>
      )}
    </div>
  );
}
