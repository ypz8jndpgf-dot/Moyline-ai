import { getTrackRecord } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function TrackRecordPage() {
  const rec = await getTrackRecord();
  const { w, l, p } = rec.totals;
  const winPct = w + l > 0 ? ((w / (w + l)) * 100).toFixed(1) : "—";

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-2">Verified results only</p>
      <h1 className="font-display text-4xl sm:text-5xl mb-1">
        ALL-TIME <span className="gold-text">RECORD</span>
      </h1>
      <p className="text-muted text-sm mb-6">
        Tracking since {rec.startDate} · every pick verified against final scores · identical picks across editions counted once
      </p>

      <div className="grid grid-cols-4 gap-3 mb-8 max-w-2xl">
        {[
          ["W", w, "text-up"],
          ["L", l, "text-down"],
          ["P", p, "text-muted"],
          ["Win%", winPct + (winPct === "—" ? "" : "%"), "text-gold"],
        ].map(([label, val, cls]) => (
          <div key={label as string} className="card p-4 text-center">
            <div className={`font-display text-3xl ${cls}`}>{val}</div>
            <div className="text-[11px] uppercase tracking-widest text-muted">{label}</div>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-muted border-b border-line">
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Game</th>
                <th className="text-left p-3">Play</th>
                <th className="text-left p-3">Result</th>
                <th className="text-left p-3">Final</th>
              </tr>
            </thead>
            <tbody>
              {rec.picks.map((pick) => (
                <tr key={pick.id} className="border-b border-line/50 last:border-0">
                  <td className="p-3 text-muted text-xs whitespace-nowrap">{pick.date}</td>
                  <td className="p-3 font-bold">
                    {pick.star && <span className="text-gold mr-1">★</span>}
                    {pick.game} <span className="text-muted font-normal text-xs">({pick.sport})</span>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {pick.play} <span className="text-muted text-xs">{pick.line} · {pick.book}</span>
                  </td>
                  <td className={`p-3 font-bold ${pick.result === "Win" ? "text-up" : pick.result === "Loss" ? "text-down" : "text-muted"}`}>
                    {pick.result}
                  </td>
                  <td className="p-3 text-muted text-xs">{pick.final}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {rec.note && <p className="text-xs text-muted mt-4">{rec.note}</p>}
      <p className="text-xs text-muted mt-4">Analysis for entertainment purposes — not financial advice.</p>
    </div>
  );
}
