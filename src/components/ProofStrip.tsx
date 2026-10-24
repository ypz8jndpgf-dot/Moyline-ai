import {
  getFeaturedMetrics,
  formatRecord,
  formatPct,
  type FeaturedMetric,
} from "@/lib/records";

/**
 * Hero proof strip — the record, above the fold, in five seconds.
 * All-time always shows; the ★ stat obeys its honesty floor (hides below
 * .500); the third slot is curated daily by fixed rules in
 * getFeaturedMetrics — the since-Oct-16 run when it clears its floor,
 * otherwise the best eligible recent window, otherwise it hides and the
 * strip reflows.
 */
export default async function ProofStrip() {
  const f = await getFeaturedMetrics();

  const thirdLabel = (m: FeaturedMetric): string =>
    m.key === "sinceRecal" ? "Since Oct 16 · Golden Run" : m.label;

  const stats: { label: string; record: string; pct: string | null }[] = [
    { label: "All-time record", record: formatRecord(f.anchor), pct: formatPct(f.anchor) },
  ];
  if (f.showStars) {
    stats.push({
      label: "★ Featured plays",
      record: formatRecord(f.stars),
      pct: formatPct(f.stars),
    });
  }
  if (f.proofThird) {
    stats.push({
      label: thirdLabel(f.proofThird),
      record: formatRecord(f.proofThird.stat),
      pct: formatPct(f.proofThird.stat),
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
