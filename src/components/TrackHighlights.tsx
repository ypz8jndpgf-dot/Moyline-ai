import { getTrackRecord } from "@/lib/store";

/**
 * Marketing highlights strip — computed live from the track record.
 * Only shows segments with enough picks to be meaningful.
 */
export default async function TrackHighlights() {
  const rec = await getTrackRecord();
  const picks = rec.picks.filter((p) => p.result !== "Pending");

  if (picks.length < 20) return null;

  const highlights: { pct: string; label: string; detail: string }[] = [];

  // Best sport (min 8 picks)
  const bySport = new Map<string, { w: number; l: number }>();
  for (const p of picks) {
    const s = bySport.get(p.sport) || { w: 0, l: 0 };
    if (p.result === "Win") s.w++;
    else if (p.result === "Loss") s.l++;
    bySport.set(p.sport, s);
  }
  let bestSport = "";
  let bestPct = 0;
  let bestRec = "";
  for (const [sport, { w, l }] of bySport) {
    if (w + l >= 8) {
      const pct = (w / (w + l)) * 100;
      if (pct > bestPct) {
        bestPct = pct;
        bestSport = sport;
        bestRec = `${w}-${l}`;
      }
    }
  }
  if (bestSport && bestPct >= 55) {
    highlights.push({
      pct: `${bestPct.toFixed(0)}%`,
      label: `${bestSport} picks`,
      detail: `${bestRec} · our hottest sport`,
    });
  }

  // Unders
  const unders = picks.filter((p) => p.play.toLowerCase().includes("under"));
  const uw = unders.filter((p) => p.result === "Win").length;
  const ul = unders.filter((p) => p.result === "Loss").length;
  if (uw + ul >= 10 && uw / (uw + ul) >= 0.55) {
    highlights.push({
      pct: `${((uw / (uw + ul)) * 100).toFixed(0)}%`,
      label: "Unders",
      detail: `${uw}-${ul} · finding value in totals`,
    });
  }

  // Recent form (last 20)
  const recent = [...picks]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 20);
  const rw = recent.filter((p) => p.result === "Win").length;
  const rl = recent.filter((p) => p.result === "Loss").length;
  if (rw + rl >= 15 && rw / (rw + rl) >= 0.55) {
    highlights.push({
      pct: `${((rw / (rw + rl)) * 100).toFixed(0)}%`,
      label: "Last 20 picks",
      detail: `${rw}-${rl} · riding hot`,
    });
  }

  // Moneylines
  const mls = picks.filter((p) => p.play.toLowerCase().includes("ml"));
  const mw = mls.filter((p) => p.result === "Win").length;
  const ml = mls.filter((p) => p.result === "Loss").length;
  if (mw + ml >= 20 && mw / (mw + ml) >= 0.54) {
    highlights.push({
      pct: `${((mw / (mw + ml)) * 100).toFixed(0)}%`,
      label: "Moneylines",
      detail: `${mw}-${ml} · picking winners outright`,
    });
  }

  if (highlights.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="card p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-4">
          Track record highlights
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {highlights.slice(0, 4).map((h) => (
            <div
              key={h.label}
              className="rounded-lg border border-gold/30 bg-gold/5 p-4 text-center"
            >
              <div className="font-display text-3xl text-gold">{h.pct}</div>
              <div className="text-sm font-semibold text-paper mt-1">{h.label}</div>
              <div className="text-[11px] text-muted mt-0.5">{h.detail}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted/60 mt-4 text-center">
          Live from {picks.length} graded picks ·{" "}
          <a href="/record" className="text-gold hover:text-goldsoft">
            Full record →
          </a>
        </p>
      </div>
    </section>
  );
}
