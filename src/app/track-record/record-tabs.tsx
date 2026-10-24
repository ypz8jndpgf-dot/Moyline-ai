"use client";

import { useState } from "react";
import type { TrackPick, TrackRecord } from "@/lib/store";
import type { RecordAnalytics, SegmentRow } from "@/lib/records";

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
        Defined subsets of the verified record — sharpened ★ plays and best sport (min. 8 decided). Every pick is listed below; nothing is hidden.
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

/* ----- Units / trajectory / segments (server-computed in lib/records) -- */

function fmtUnits(u: number): string {
  return `${u >= 0 ? "+" : "-"}${Math.abs(u).toFixed(1)}u`;
}

function fmtRoi(roiPct: number | null): string {
  if (roiPct === null) return "—";
  return `${roiPct >= 0 ? "+" : "-"}${Math.abs(roiPct).toFixed(1)}%`;
}

function UnitsBand({ analytics }: { analytics: RecordAnalytics }) {
  const { allTime, preRecal, postRecal } = analytics;
  const cards: { label: string; value: string; sub: string; cls: string }[] = [
    {
      label: "All-time units",
      value: fmtUnits(allTime.units.units),
      sub: `${allTime.w}–${allTime.l}${allTime.p ? `–${allTime.p}` : ""} all-time`,
      cls: allTime.units.units >= 0 ? "text-emerald-400" : "text-red-400",
    },
    {
      label: "All-time ROI",
      value: fmtRoi(allTime.units.roiPct),
      sub: "return on units risked",
      cls: (allTime.units.roiPct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400",
    },
    {
      label: "Before Oct 16",
      value: fmtUnits(preRecal.units.units),
      sub: `${preRecal.w}–${preRecal.l}${preRecal.p ? `–${preRecal.p}` : ""} · pre-recalibration`,
      cls: preRecal.units.units >= 0 ? "text-emerald-400" : "text-red-400",
    },
    {
      label: "Since Oct 16",
      value: fmtUnits(postRecal.units.units),
      sub: `${postRecal.w}–${postRecal.l}${postRecal.p ? `–${postRecal.p}` : ""} · post-recalibration`,
      cls: postRecal.units.units >= 0 ? "text-emerald-400" : "text-red-400",
    },
  ];
  return (
    <div className="mb-8">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-3">
        Units · at published prices
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="card p-5 text-center relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
            <div className={`font-display text-3xl sm:text-4xl ${c.cls}`}>{c.value}</div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted mt-1">{c.label}</div>
            <div className="text-xs text-muted mt-1">{c.sub}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-2">
        1 unit risked per pick at the price it was published at · computed on{" "}
        {allTime.units.priced} of {allTime.units.graded} graded picks with a recorded price.
      </p>
    </div>
  );
}

function TrajectoryChart({ analytics }: { analytics: RecordAnalytics }) {
  const pts = analytics.trajectory;
  if (pts.length < 2) return null;
  const W = 720, H = 260, PL = 48, PR = 16, PT = 20, PB = 28;
  const iw = W - PL - PR, ih = H - PT - PB;
  const day = (d: string) => Date.parse(`${d}T12:00:00Z`) / 86400000;
  const x0 = day(pts[0].date);
  const x1 = day(pts[pts.length - 1].date);
  let lo = Math.min(0, ...pts.map((p) => p.cumUnits));
  let hi = Math.max(0, ...pts.map((p) => p.cumUnits));
  const padY = Math.max(1, (hi - lo) * 0.1);
  lo -= padY;
  hi += padY;
  const X = (d: string) => PL + ((day(d) - x0) / Math.max(1, x1 - x0)) * iw;
  const Y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * ih;
  const all = [{ date: pts[0].date, cumUnits: 0 }, ...pts];
  const line = all
    .map((p) => `${X(p.date).toFixed(1)},${Y(p.cumUnits).toFixed(1)}`)
    .join(" ");
  const last = pts[pts.length - 1];
  const area = `${PL},${Y(0).toFixed(1)} ${line} ${X(last.date).toFixed(1)},${Y(0).toFixed(1)}`;
  const recalX = X(analytics.recalDate);
  const recalLabelAnchor = recalX > W * 0.55 ? "end" : "middle";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = (d: string) => {
    const [, m, dd] = d.split("-");
    return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(dd, 10)}`;
  };
  return (
    <div className="mb-8">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-3">
        Units trajectory · cumulative
      </p>
      <div className="card p-4 sm:p-5">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Cumulative units over time">
          {/* zero line */}
          <line x1={PL} x2={W - PR} y1={Y(0)} y2={Y(0)} stroke="#3f3f46" strokeDasharray="3 4" strokeWidth="1" />
          {/* recalibration marker */}
          <line x1={recalX} x2={recalX} y1={PT} y2={H - PB} stroke="#f5c518" strokeDasharray="4 4" strokeWidth="1" opacity="0.7" />
          <text x={recalX} y={PT - 6} textAnchor={recalLabelAnchor} fontSize="11" fill="#f5c518" fontWeight="bold">
            Oct 16 · algo recalibrated
          </text>
          {/* area + line */}
          <polygon points={area} fill="#f5c518" opacity="0.08" />
          <polyline points={line} fill="none" stroke="#f5c518" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={X(last.date)} cy={Y(last.cumUnits)} r="4" fill="#f5c518" />
          <text x={X(last.date)} y={Y(last.cumUnits) - 10} textAnchor="end" fontSize="12" fill="#f5c518" fontWeight="bold">
            {fmtUnits(last.cumUnits)}
          </text>
          {/* y axis labels */}
          <text x={PL - 6} y={Y(hi - padY) + 4} textAnchor="end" fontSize="10" fill="#a1a1aa">
            {fmtUnits(hi - padY)}
          </text>
          <text x={PL - 6} y={Y(lo + padY) + 4} textAnchor="end" fontSize="10" fill="#a1a1aa">
            {fmtUnits(lo + padY)}
          </text>
          {/* x axis labels */}
          <text x={PL} y={H - 6} textAnchor="start" fontSize="10" fill="#a1a1aa">
            {fmtDate(pts[0].date)}
          </text>
          <text x={W - PR} y={H - 6} textAnchor="end" fontSize="10" fill="#a1a1aa">
            {fmtDate(last.date)}
          </text>
        </svg>
        <p className="text-xs text-muted mt-2">
          Every graded pick at its published price — the dip is the old algo; the line since the
          Oct 16 recalibration is the current one.
        </p>
      </div>
    </div>
  );
}

function SegmentTable({ title, rows }: { title: string; rows: SegmentRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="card overflow-hidden">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold p-3.5 pb-0">
        {title}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.2em] text-muted border-b border-line">
              <th className="text-left p-3.5">Segment</th>
              <th className="text-left p-3.5">Record</th>
              <th className="text-left p-3.5">Win %</th>
              <th className="text-left p-3.5">Units</th>
              <th className="text-left p-3.5">ROI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-line/50 last:border-0 hover:bg-white/[0.02] transition-colors">
                <td className="p-3.5 font-bold whitespace-nowrap">{r.label}</td>
                <td className="p-3.5 whitespace-nowrap">
                  <span className="text-emerald-400">{r.stat.w}</span>
                  <span className="text-muted">–</span>
                  <span className="text-red-400">{r.stat.l}</span>
                  {r.stat.p > 0 && (
                    <>
                      <span className="text-muted">–</span>
                      <span className="text-zinc-400">{r.stat.p}</span>
                    </>
                  )}
                </td>
                <td className="p-3.5 text-gold font-bold whitespace-nowrap">
                  {r.stat.pct === null ? "—" : `${r.stat.pct.toFixed(1)}%`}
                </td>
                <td className={`p-3.5 font-bold whitespace-nowrap ${r.stat.units.units >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {fmtUnits(r.stat.units.units)}
                </td>
                <td className="p-3.5 text-muted whitespace-nowrap">{fmtRoi(r.stat.units.roiPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SegmentTables({ analytics }: { analytics: RecordAnalytics }) {
  return (
    <div className="mb-8">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-3">
        Record by segment · all-time
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <SegmentTable title="By sport" rows={analytics.bySport} />
        <SegmentTable title="By play type" rows={analytics.byType} />
      </div>
      <SegmentTable title="Player props by market" rows={analytics.propMarkets} />
      <p className="text-xs text-muted mt-2 max-w-2xl">
        Every segment of the verified record — the strong and the weak alike. Nothing is
        filtered out; segments are how the algo decides where its edge actually lives.
      </p>
    </div>
  );
}

const REGIME_RULES = [
  ["Recalibrated Oct 16", "359 bets analyzed — confidence tiers fixed, stars sharpened"],
  ["Quantified edge", "Every play states its edge as a number. No number, no grid spot"],
  ["Workhorse tier", "Conf-3 is the primary tier (54%); conf-4 is star-quality only"],
  ["Sharpened stars", "★ only for NHL/NFL ML & spread — 74% hit rate"],
];

export default function RecordTabs({
  rec,
  analytics,
}: {
  rec: TrackRecord;
  analytics: RecordAnalytics;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const optStart = rec.optimizedStartDate ?? "2026-10-16";
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
            <span className="text-xs font-bold uppercase tracking-[0.3em] text-gold">Recalibrated regime</span>
            <span className="text-[11px] text-muted">since {optStart} · 359 bets analyzed</span>
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

      <UnitsBand analytics={analytics} />
      <TrajectoryChart analytics={analytics} />

      <div className="mb-8 max-w-2xl">
        <StatCards t={t} />
        <WinBar t={t} />
      </div>

      <Featured picks={shown} />
      <SegmentTables analytics={analytics} />
      <PickTable picks={shown} />

      {rec.note && <p className="text-xs text-muted mt-4 max-w-2xl">{rec.note}</p>}
      <p className="text-xs text-muted mt-4">Analysis for entertainment purposes — not financial advice.</p>
    </div>
  );
}
