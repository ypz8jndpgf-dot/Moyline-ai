import Link from "next/link";
import {
  getFeaturedMetrics,
  formatPct,
  formatUnits,
  formatRoi,
  type StatWithUnits,
} from "@/lib/records";

/**
 * THE RECORD — featured record block for the homepage, styled after the
 * /share pick cards (black card, gold glow, small-caps gold eyebrow).
 * The anchor cell is the all-time record with its units at published
 * prices — always shown, per the standing honesty rule. Beside it, the
 * two best story stats selected daily by the fixed curation rules in
 * getFeaturedMetrics (labeled windows/segments that clear sample and
 * performance floors). The complete record lives one tap away.
 */
export default async function FeaturedRecord() {
  const f = await getFeaturedMetrics();
  const stories = f.stories.slice(0, 2);

  const cells: {
    label: string;
    stat: StatWithUnits;
    note: string;
    anchor?: boolean;
  }[] = [
    {
      label: "All-time",
      stat: f.anchor,
      note: "Every graded pick, ever",
      anchor: true,
    },
    ...stories.map((s) => ({
      label: s.label,
      stat: s.stat,
      note: s.note,
    })),
  ];

  const cols =
    cells.length === 3
      ? "grid-cols-1 sm:grid-cols-3"
      : cells.length === 2
        ? "grid-cols-2"
        : "grid-cols-1";

  return (
    <section className="mb-10">
      <div className="card card-glow p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
        <div className="flex items-baseline justify-between gap-4 mb-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-1">
              MoyLine AI · Verified
            </p>
            <h2 className="font-display text-3xl sm:text-4xl">
              THE <span className="gold-text">RECORD</span>
            </h2>
          </div>
          <Link
            href="/track-record"
            className="shrink-0 text-xs font-bold uppercase tracking-widest text-gold hover:text-goldsoft transition-colors"
          >
            Full record →
          </Link>
        </div>

        <div className={`grid ${cols} gap-4`}>
          {cells.map((c) => (
            <div
              key={c.label}
              className="rounded-lg border border-gold/30 bg-black/40 px-4 py-5 text-center"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">
                {c.label}
              </p>
              <p className="font-display text-3xl sm:text-4xl mt-2">
                <span className="text-emerald-400">{c.stat.w}</span>
                <span className="text-muted">–</span>
                <span className="text-red-400">{c.stat.l}</span>
                {c.stat.p > 0 && (
                  <>
                    <span className="text-muted">–</span>
                    <span className="text-zinc-400">{c.stat.p}</span>
                  </>
                )}
              </p>
              {formatPct(c.stat) && (
                <p className="text-gold font-bold text-lg mt-1">{formatPct(c.stat)}</p>
              )}
              <p
                className={`font-bold text-sm mt-1 ${
                  c.stat.units.units >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {formatUnits(c.stat.units.units)}
                {c.anchor && (
                  <span className="text-muted font-normal text-[11px]">
                    {" "}· units at published prices
                    {formatRoi(c.stat.units.roiPct) &&
                      ` · ${formatRoi(c.stat.units.roiPct)}`}
                  </span>
                )}
              </p>
              <p className="text-[11px] text-muted mt-1">{c.note}</p>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted mt-5 text-center">
          No cherry-picking, no deleted picks — the track record is the product.
        </p>
      </div>
    </section>
  );
}
