import { getTrackRecord } from "@/lib/store";
import { getPicksFeed } from "@/lib/picks";

export default async function FeaturedPlays() {
  const rec = await getTrackRecord();
  // Sharpened ★ criteria (Oct 16 recalibration): NHL/NFL moneyline or spread only.
  // This correlates with the 74% marketed on the splash page.
  const isSharpenedStar = (p: any) => {
    if (!p.star) return false;
    const sport = (p.sport || "").toUpperCase();
    const isNHL = sport.includes("NHL");
    const isNFL = sport.includes("NFL");
    if (!isNHL && !isNFL) return false;
    const play = (p.play || "").toLowerCase();
    const line = (p.line || "").toLowerCase();
    const combined = play + " " + line;
    // Exclude totals and props
    if (/\bover\b|\bunder\b|\btotal\b/.test(combined)) return false;
    if (/prop/.test(combined)) return false;
    return true;
  };
  
  const stars = rec.picks
    .filter((p) => isSharpenedStar(p) && p.result !== "Pending")
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  // Include pending stars from the track record AND today's live picks feed
  // (the feed has today's ★ before the morning grader runs).
  const pendingStars = rec.picks
    .filter((p) => isSharpenedStar(p) && p.result === "Pending")
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  
  // Also check today's feed for starred picks not yet in the track record.
  try {
    const feed = await getPicksFeed();
    if (feed?.picks) {
      const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      for (const p of feed.picks) {
        if (p.star) {
          // Apply sharpened criteria to feed picks too
          const sportMatch = p.game.match(/\(([^)]+)\)/);
          const feedSport = sportMatch ? sportMatch[1].toUpperCase() : "";
          const isNHL = feedSport.includes("NHL");
          const isNFL = feedSport.includes("NFL");
          if (!isNHL && !isNFL) continue;
          const playLower = (p.play || "").toLowerCase();
          if (/\bover\b|\bunder\b|\btotal\b|prop/.test(playLower)) continue;
          
          // Avoid duplicates with track record pending stars
          const exists = pendingStars.some((s) => s.game === p.game && s.date === todayET);
          if (!exists) {
            pendingStars.push({
              id: `feed-${p.game}-${todayET}`,
              date: todayET,
              game: p.game,
              play: p.play,
              line: p.price || "",
              book: "",
              sport: "",
              result: "Pending",
              star: true,
              conf: p.confidence?.toString() || "",
            } as any);
          }
        }
      }
    }
  } catch {
    // Feed unavailable — use track record only.
  }
  
  pendingStars.sort((a, b) => (a.date < b.date ? 1 : -1));
  const w = stars.filter((p) => p.result === "Win").length;
  const l = stars.filter((p) => p.result === "Loss").length;
  const p = stars.filter((p) => p.result === "Push").length;
  const pct = w + l > 0 ? ((w / (w + l)) * 100).toFixed(1) : null;
  const recent = [...pendingStars, ...stars].slice(0, 5);

  if (stars.length === 0 && pendingStars.length === 0) return null;

  return (
    <section className="mb-10">
      <div className="card card-glow p-5 sm:p-6 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
          <div className="shrink-0">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-1">
              ★ Featured plays
            </p>
            <div className="font-display text-4xl">
              <span className="text-emerald-400">{w}</span>
              <span className="text-muted">–</span>
              <span className="text-red-400">{l}</span>
              {p > 0 && (
                <>
                  <span className="text-muted">–</span>
                  <span className="text-zinc-400">{p}</span>
                </>
              )}
              {pct && <span className="text-gold text-2xl ml-3">{pct}%</span>}
            </div>
            <p className="text-xs text-muted mt-1">Biggest-edge plays · verified record</p>
          </div>
          <div className="flex-1 min-w-0 divide-y divide-line/50">
            {recent.map((pick) => (
              <div key={pick.id} className="py-2 flex items-center gap-3 text-sm">
                <span
                  className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                    pick.result === "Win"
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : pick.result === "Loss"
                        ? "bg-red-500/15 text-red-400 border-red-500/30"
                        : pick.result === "Pending"
                          ? "bg-amber-500/15 text-gold border-amber-500/30 animate-pulse"
                          : "bg-zinc-500/15 text-zinc-400 border-zinc-500/30"
                  }`}
                >
                  {pick.result}
                </span>
                <div className="min-w-0">
                  <span className="font-bold truncate block sm:inline">{pick.game}</span>
                  <span className="text-muted text-xs sm:ml-2">
                    {pick.play} {pick.line} · {pick.date.slice(5)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
