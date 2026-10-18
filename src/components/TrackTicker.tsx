import { getTrackRecord } from "@/lib/store";

/**
 * Scrolling ticker tape of live track-record highlights.
 * Pure CSS animation, no JS needed.
 */
export default async function TrackTicker() {
  const rec = await getTrackRecord();
  const picks = rec.picks.filter((p) => p.result !== "Pending");

  if (picks.length < 20) return null;

  const items: string[] = [];

  // Overall record
  const w = rec.totals.w;
  const l = rec.totals.l;
  const pct = w + l > 0 ? ((w / (w + l)) * 100).toFixed(1) : "0";
  items.push(`★ ALL-TIME ${w}-${l} (${pct}%)`);

  // Best sport (min 8 picks)
  const bySport = new Map<string, { w: number; l: number }>();
  for (const p of picks) {
    const s = bySport.get(p.sport) || { w: 0, l: 0 };
    if (p.result === "Win") s.w++;
    else if (p.result === "Loss") s.l++;
    bySport.set(p.sport, s);
  }
  for (const [sport, { w: sw, l: sl }] of bySport) {
    if (sw + sl >= 8) {
      const sp = ((sw / (sw + sl)) * 100).toFixed(0);
      if (parseFloat(sp) >= 50) items.push(`${sport.toUpperCase()} ${sw}-${sl} (${sp}%)`);
    }
  }

  // Unders (min 10 picks, min 50% win rate)
  const unders = picks.filter((p) => p.play.toLowerCase().includes("under"));
  const uw = unders.filter((p) => p.result === "Win").length;
  const ul = unders.filter((p) => p.result === "Loss").length;
  if (uw + ul >= 10 && uw / (uw + ul) >= 0.5) {
    items.push(`UNDERS ${uw}-${ul} (${((uw / (uw + ul)) * 100).toFixed(0)}%)`);
  }

  // Recent form (min 8 graded, min 50% win rate)
  const recent = [...picks].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  const rw = recent.filter((p) => p.result === "Win").length;
  const rl = recent.filter((p) => p.result === "Loss").length;
  if (rw + rl >= 8 && rw / (rw + rl) >= 0.5) {
    items.push(`LAST 10: ${rw}-${rl}`);
  }

  if (items.length < 2) return null;

  // Duplicate for seamless loop
  const doubled = [...items, ...items];

  return (
    <div className="overflow-hidden border-y border-gold/30 bg-black/60 py-2 mb-8 -mx-4 sm:-mx-6">
      <div
        className="flex whitespace-nowrap gap-8 animate-ticker"
        style={{ width: "max-content" }}
      >
        {doubled.map((item, i) => (
          <span
            key={i}
            className="text-xs font-bold uppercase tracking-[0.2em] text-gold/90"
          >
            {item}
            <span className="ml-8 text-gold/40">✦</span>
          </span>
        ))}
      </div>
      <style>{`
        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-ticker {
          animation: ticker-scroll 30s linear infinite;
        }
        .animate-ticker:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}
