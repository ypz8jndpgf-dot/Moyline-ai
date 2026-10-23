import { getShowcaseRecords, formatRecord, formatPct } from "@/lib/records";

/**
 * Hero proof strip — the record, above the fold, in five seconds.
 * All-time always shows; the ★ and since-Oct-16 stats obey the standing
 * honesty floors (★ hides below .500, Golden Run hides below 55%) and
 * the strip reflows with whatever stats remain.
 */
export default async function ProofStrip() {
  const r = await getShowcaseRecords();

  const stats: { label: string; record: string; pct: string | null }[] = [
    { label: "All-time record", record: formatRecord(r.allTime), pct: formatPct(r.allTime) },
  ];
  if (r.showStars) {
    stats.push({
      label: "★ Featured plays",
      record: formatRecord(r.stars),
      pct: formatPct(r.stars),
    });
  }
  if (r.showSinceRecal) {
    stats.push({
      label: "Since Oct 16 · Golden Run",
      record: formatRecord(r.sinceRecal),
      pct: formatPct(r.sinceRecal),
    });
  }

  return (
    <div className="mb-8 rounded-lg border border-gold/30 bg-black/40 px-4 py-4 sm:px-6">
      <div
        className={`grid gap-4 text-center ${
          stats.length === 3
            ? "grid-cols-3"
            : stats.length === 2
              ? "grid-cols-2"
              : "grid-cols-1"
        }`}
      >
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.2em] text-gold">
              {s.label}
            </p>
            <p className="font-display text-2xl sm:text-3xl mt-1">
              {s.record}
              {s.pct && <span className="text-gold text-lg sm:text-xl ml-2">{s.pct}</span>}
            </p>
          </div>
        ))}
      </div>
      <p className="text-center text-[11px] text-muted mt-3">
        Every play graded and published — wins and losses.
      </p>
    </div>
  );
}
