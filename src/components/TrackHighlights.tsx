import { getTrackRecord } from "@/lib/store";

/**
 * Marketing highlights strip — fully dynamic from the live track record.
 * Any segment clearing 50% with enough picks shows up automatically.
 * Anything below 50% is hidden.
 */
export default async function TrackHighlights() {
  const rec = await getTrackRecord();
  const picks = rec.picks.filter((p) => p.result !== "Pending");

  if (picks.length < 20) return null;

  const tally = (list: typeof picks): [number, number] => [
    list.filter((p) => p.result === "Win").length,
    list.filter((p) => p.result === "Loss").length,
  ];

  const cards: { pct: string; label: string; detail: string; score: number }[] = [];
  const add = (label: string, w: number, l: number, detail: string, minPicks: number) => {
    if (w + l >= minPicks && w / (w + l) >= 0.5) {
      cards.push({
        pct: `${((w / (w + l)) * 100).toFixed(0)}%`,
        label,
        detail: `${w}-${l} · ${detail}`,
        score: w / (w + l),
      });
    }
  };

  // By sport (min 8)
  const bySport = new Map<string, typeof picks>();
  for (const p of picks) {
    const arr = bySport.get(p.sport) || [];
    arr.push(p);
    bySport.set(p.sport, arr);
  }
  for (const [sport, list] of bySport) {
    const [w, l] = tally(list);
    add(`${sport} picks`, w, l, "by sport", 8);
  }

  // By play type (min 8)
  const types: [string, string, (play: string) => boolean][] = [
    ["Unders", "finding value in totals", (pl) => pl.toLowerCase().includes("under")],
    ["Overs", "riding the over wave", (pl) => pl.toLowerCase().includes("over")],
    ["Moneylines", "picking winners outright", (pl) => pl.toLowerCase().includes("ml")],
    ["Spreads", "beating the number", (pl) => /[+-]\d+\.5|[+-][1-9]\d?\b/.test(pl)],
  ];
  for (const [label, detail, match] of types) {
    const [w, l] = tally(picks.filter((p) => match(p.play)));
    add(label, w, l, detail, 8);
  }

  // Recent form: last 20 (min 15 graded)
  const recent = [...picks].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 20);
  const [rw, rl] = tally(recent);
  add("Last 20 picks", rw, rl, "recent form", 15);

  if (cards.length === 0) return null;

  // Hottest first, max 4
  cards.sort((a, b) => b.score - a.score);
  const show = cards.slice(0, 4);

  return (
    <section className="mb-10">
      <div className="card p-5 sm:p-6">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-4">
          Track record highlights
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {show.map((h) => (
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
