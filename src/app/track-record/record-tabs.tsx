"use client";

import { useState } from "react";
import type { TrackPick, TrackRecord } from "@/lib/store";

type Tab = "all" | "opt";

function tally(list: TrackPick[]) {
  const w = list.filter((x) => x.result === "Win").length;
  const l = list.filter((x) => x.result === "Loss").length;
  const p = list.filter((x) => x.result === "Push").length;
  const pending = list.filter((x) => x.result === "Pending").length;
  const decided = w + l;
  const pct = decided > 0 ? ((w / decided) * 100).toFixed(1) : null;
  return { w, l, p, pending, decided, pct };
}

function ResultBadge({ result }: { result: TrackPick["result"] }) {
  const styles: Record<string, string> = {
    Win: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    Loss: "bg-red-500/15 text-red-400 border-red-500/30",
    Push: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
    Pending: "bg-amber-500/15 text-gold border-amber-500/30 animate-pulse",
  };
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border ${styles[result]}`}>
      {result}
    </span>
  );
}

function StatCards({ t }: { t: ReturnType<typeof tally> }) {
  const stats: [string, string | number, string][] = [
    ["Wins", t.w, "text-emerald-400"],
    ["Losses", t.l, "text-red-400"],
    ["Pushes", t.p, "text-zinc-400"],
    ["Win %", t.pct === null ? "—" : `${t.pct}%`, "text-gold"],
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(([label, val, cls]) => (
        <div key={label} className="card p-5 text-center relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
          <div className={`font-display text-4xl ${cls}`}>{val}</div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted mt-1">{label}</div>
        </div>
      ))}
    </div>
  );
}

function WinBar({ t }: { t: ReturnType<typeof tally> }) {
  if (t.decided === 0) return null;
  const wPct = (t.w / t.decided) * 100;
  return (
    <div className="mt-4">
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden flex">
        <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all" style={{ width: `${wPct}%` }} />
        <div className="h-full bg-gradient-to-r from-red-500 to-red-400" style={{ width: `${100 - wPct}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-muted mt-1.5">
        <span>{t.decided} decided picks</span>
        {t.pending > 0 && <span className="text-gold">{t.pending} pending</span>}
      </div>
    </div>
  );
}

function Featured({ picks }: { picks: TrackPick[] }) {
  const stars = tally(picks.filter((x) => x.star));
  const conf4 = tally(picks.filter((x) => x.conf === "4"));
  const bySport = new Map<string, TrackPick[]>();
  for (const x of picks) {
    const s = x.sport || "Other";
    if (!bySport.has(s)) bySport.set(s, []);
    bySport.get(s)!.push(x);
  }
  let best: { name: string; t: ReturnType<typeof tally> } | null = null;
  for (const [name, list] of bySport) {
    const t = tally(list);
    if (t.decided >= 8 && (!best || parseFloat(t.pct ?? "0") > parseFloat(best.t.pct ?? "0"))) best = { name, t };
  }
  const cards: { label: string; t: ReturnType<typeof tally> }[] = [];
  if (stars.decided > 0) cards.push({ label: "★ Featured plays", t: stars });
  if (conf4.decided > 0) cards.push({ label: "Conf-4 top plays", t: conf4 });
  if (best) cards.push({ label: `Best sport · ${best.name}`, t: best.t });
  if (cards.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-3">Featured angles</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        {cards.map(({ label, t }) => (
          <div key={label} className="card p-5">
            <div className="font-display text-2xl text-gold">
              {t.w}-{t.l}{t.p ? `-${t.p}` : ""}
            </div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted mt-1">{label}</div>
            <div className="text-xs text-muted mt-1">{t.pct}% of decided</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mb-8 max-w-2xl">
        Defined subsets of the verified record — biggest-edge ★ plays, confidence-4 top plays, best sport (min. 8 decided). Every pick is listed below; nothing is hidden.
      </p>
    </div>
  );
}

function PickTable({ picks }: { picks: TrackPick[] }) {
  const sorted = [...picks].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.2em] text-muted border-b border-line bg-white/[0.02]">
              <th className="text-left p-3.5">Date</th>
              <th className="text-left p-3.5">Game</th>
              <th className="text-left p-3.5">Play</th>
              <th className="text-left p-3.5">Result</th>
              <th className="text-left p-3.5">Final</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((pick) => (
              <tr key={pick.id} className="border-b border-line/50 last:border-0 hover:bg-white/[0.02] transition-colors">
                <td className="p-3.5 text-muted text-xs whitespace-nowrap">{pick.date}</td>
                <td className="p-3.5 font-bold">
                  {pick.star && <span className="text-gold mr-1.5">★</span>}
                  {pick.game} <span className="text-muted font-normal text-xs">· {pick.sport}</span>
                </td>
                <td className="p-3.5 whitespace-nowrap">
                  {pick.play} <span className="text-muted text-xs">{pick.line} · {pick.book}</span>
                </td>
                <td className="p-3.5"><ResultBadge result={pick.result} /></td>
                <td className="p-3.5 text-muted text-xs">{pick.final}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const REGIME_RULES = [
  ["Max 3 plays", "One or two when that's all that qualifies — never filled for appearance"],
  ["Quantified edge", "Every play states its edge as a number. No number, no grid spot"],
  ["Earned confidence", "4+ only with best price confirmed and no rotation uncertainty"],
  ["Daily self-tuning", "The algorithm re-grades itself every morning at 4am ET"],
];

export default function RecordTabs({ rec }: { rec: TrackRecord }) {
  const [tab, setTab] = useState<Tab>("all");
  const optStart = rec.optimizedStartDate ?? "2026-10-08";
  const allPicks = rec.picks.filter((x) => x.result !== "Pending");
  const optPicks = rec.picks.filter((x) => x.date >= optStart);
  const shown = tab === "all" ? allPicks : optPicks;
  const t = tally(shown);

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-2">Verified results only</p>
      <h1 className="font-display text-4xl sm:text-5xl mb-1">
        TRACK <span className="gold-text">RECORD</span>
      </h1>
      <p className="text-muted text-sm mb-6">
        Every pick verified against final scores · identical picks across editions counted once
      </p>

      <div className="inline-flex rounded-full border border-line bg-white/[0.03] p-1 mb-8">
        {(
          [
            ["all", "All-time"],
            ["opt", "Optimized"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-5 py-2 rounded-full text-sm font-bold transition-all ${
              tab === id ? "bg-gold text-black shadow" : "text-muted hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "opt" && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold uppercase tracking-[0.3em] text-gold">New regime</span>
            <span className="text-[11px] text-muted">since {optStart}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {REGIME_RULES.map(([title, desc]) => (
              <div key={title} className="card p-4 border-gold/20">
                <div className="font-bold text-sm text-gold mb-1">{title}</div>
                <div className="text-xs text-muted leading-relaxed">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-2 flex items-baseline gap-3">
        <span className="font-display text-5xl sm:text-6xl">
          <span className="text-emerald-400">{t.w}</span>
          <span className="text-muted">–</span>
          <span className="text-red-400">{t.l}</span>
          {t.p > 0 && (<><span className="text-muted">–</span><span className="text-zinc-400">{t.p}</span></>)}
        </span>
        {t.pct !== null && <span className="text-gold font-display text-2xl">{t.pct}%</span>}
      </div>
      <p className="text-xs text-muted mb-6">
        {tab === "all"
          ? `All-time record since ${rec.startDate}`
          : "Picks under the optimized selection rules"}
      </p>

      <div className="mb-8 max-w-2xl">
        <StatCards t={t} />
        <WinBar t={t} />
      </div>

      <Featured picks={shown} />
      <PickTable picks={shown} />

      {rec.note && <p className="text-xs text-muted mt-4 max-w-2xl">{rec.note}</p>}
      <p className="text-xs text-muted mt-4">Analysis for entertainment purposes — not financial advice.</p>
    </div>
  );
}
