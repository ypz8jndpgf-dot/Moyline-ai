import { getShowcaseRecords } from "@/lib/records";

/**
 * THE GOLDEN STICKER — the record since the Oct 16 algo recalibration,
 * computed live from the graded track record via the shared showcase
 * helper. Auto-hides below a 55% win rate (standing honesty rule:
 * never showcase a losing segment).
 */
export default async function GoldenRun() {
  const { sinceRecal, showSinceRecal } = await getShowcaseRecords();
  const { w, l } = sinceRecal;
  const total = w + l;

  if (!showSinceRecal) return null;

  const pct = `${((w / total) * 100).toFixed(0)}%`;

  return (
    <section className="mt-6 mb-2">
      <div className="relative overflow-hidden rounded-xl border-2 border-gold bg-gradient-to-r from-gold/25 via-gold/10 to-gold/25 px-5 py-5 sm:px-8 shadow-[0_0_35px_rgba(212,175,55,0.25)]">
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
          {/* The sticker */}
          <div className="shrink-0 -rotate-3 rounded-full bg-gradient-to-br from-yellow-200 via-gold to-yellow-600 px-5 py-3 text-center shadow-lg ring-4 ring-gold/40">
            <div className="text-[10px] font-black uppercase tracking-widest text-black/70">
              ⭐ Golden run
            </div>
            <div className="font-display text-3xl leading-none text-black">
              {w}-{l}
            </div>
            <div className="text-[10px] font-black uppercase tracking-widest text-black/70">
              since recal
            </div>
          </div>

          <div className="text-center sm:text-left">
            <p className="font-display text-2xl sm:text-3xl leading-tight">
              <span className="gold-text">{pct} winners</span> since we rebuilt the algo.
            </p>
            <p className="text-sm text-muted mt-1 max-w-xl">
              Every graded pick since the Oct 16 recalibration — {w} wins, {l} losses,
              no cherry-picking. The sticker stays up only while the run stays golden.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
