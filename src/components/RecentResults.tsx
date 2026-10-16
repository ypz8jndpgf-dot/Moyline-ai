import { getTrackRecord } from "@/lib/store";

export default async function RecentResults() {
  const rec = await getTrackRecord();
  const graded = rec.picks
    .filter((p) => p.result !== "Pending")
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 10);

  const { w, l, p } = rec.totals;
  const pct = w + l > 0 ? ((w / (w + l)) * 100).toFixed(1) : null;

  return (
    <section className="mb-10">
      <div className="card card-glow p-5 sm:p-6 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
        <div className="flex items-baseline justify-between gap-4 mb-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-1">
              Recent results
            </p>
            <div className="font-display text-3xl">
              <span className="text-emerald-400">{w}</span>
              <span className="text-muted">–</span>
              <span className="text-red-400">{l}</span>
              {p > 0 && (
                <>
                  <span className="text-muted">–</span>
                  <span className="text-zinc-400">{p}</span>
                </>
              )}
              {pct && <span className="text-gold text-xl ml-3">{pct}%</span>}
            </div>
            <p className="text-xs text-muted mt-1">Every pick graded · win-loss-push</p>
          </div>
          <a
            href="/record"
            className="shrink-0 text-xs font-bold uppercase tracking-widest text-gold hover:text-goldsoft transition-colors"
          >
            Full record →
          </a>
        </div>

        {graded.length === 0 ? (
          <p className="text-sm text-muted py-4 text-center">
            Track record building — check back after tonight's games.
          </p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 sm:grid sm:grid-cols-5 sm:overflow-visible">
            {graded.map((pick) => (
              <div
                key={pick.id}
                className="shrink-0 w-44 sm:w-auto rounded-lg border border-line/60 bg-smoke/50 p-3 flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                      pick.result === "Win"
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : pick.result === "Loss"
                          ? "bg-red-500/15 text-red-400 border-red-500/30"
                          : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
                    }`}
                  >
                    {pick.result === "Win" ? "W" : pick.result === "Loss" ? "L" : "Push"}
                  </span>
                  {pick.star && <span className="text-gold text-sm">★</span>}
                </div>
                <p className="text-xs font-semibold text-paper leading-tight line-clamp-2">
                  {pick.play}
                </p>
                <p className="text-[11px] text-muted leading-tight truncate">{pick.game}</p>
                {pick.final && (
                  <p className="text-[11px] text-muted/70 truncate">{pick.final}</p>
                )}
                <p className="text-[10px] text-muted/50 mt-auto">{pick.date}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
