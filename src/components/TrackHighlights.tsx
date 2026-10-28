import { getTrackRecord } from "@/lib/store";
import { classifyPick } from "@/lib/records";

/**
 * Marketing highlights strip — fully dynamic from the live track record.
 * Any segment clearing 50% with enough picks shows up automatically.
 * Anything below 50% is hidden.
 *
 * Play-type segments MUST use classifyPick (the same classifier behind
 * /track-record and the homepage trend cards) — never substring matchers.
 * The old includes("ml") matcher missed moneylines written as bare prices
 * ("Ducks +112") and swept in parlay tickets containing "ML", so this strip
 * showed Moneylines 69-60 while /track-record said 73-59-1 (caught by the
 * showcase audit, 2026-10-27).
 */
export default async function TrackHighlights() {
  const rec = await getTrackRecord();
  const picks = rec.picks.filter((p) => p.result !== "Pending");

  if (picks.length < 20) return null;

  const tally = (list: typeof picks): [number, number, number] => [
    list.filter((p) => p.result === "Win").length,
    list.filter((p) => p.result === "Loss").length,
    list.filter((p) => p.result === "Push").length,
  ];

  const cards: { pct: string; label: string; detail: string; score: number }[] = [];
  const add = (label: string, w: number, l: number, p: number, detail: string, minPicks: number) => {
    if (w + l >= minPicks && w / (w + l) >= 0.5) {
      const record = p > 0 ? `${w}-${l}-${p}` : `${w}-${l}`;
      cards.push({
        pct: `${((w / (w + l)) * 100).toFixed(0)}%`,
        label,
        detail: `${record} · ${detail}`,
        score: w / (w + l),
      });
    }
  };

  // By sport (min 15 decisions — showcase segment floor)
  const bySport = new Map<string, typeof picks>();
  for (const p of picks) {
    const arr = bySport.get(p.sport) || [];
    arr.push(p);
    bySport.set(p.sport, arr);
  }
  for (const [sport, list] of bySport) {
    const [w, l, p] = tally(list);
    add(`${sport} picks`, w, l, p, "by sport", 15);
  }

  // By play type (min 15) — classified with the shared classifier
  const types: [string, string, (p: (typeof picks)[number]) => boolean][] = [
    ["Unders", "finding value in totals", (p) => classifyPick(p) === "Total" && /\bunder\b/i.test(p.play) && !/team total/i.test(p.play)],
    ["Overs", "riding the over wave", (p) => classifyPick(p) === "Total" && /\bover\b/i.test(p.play) && !/team total/i.test(p.play)],
    ["Moneylines", "picking winners outright", (p) => classifyPick(p) === "Moneyline"],
    ["Spreads", "beating the number", (p) => classifyPick(p) === "Spread"],
  ];
  for (const [label, detail, match] of types) {
    const [w, l, p] = tally(picks.filter(match));
    add(label, w, l, p, detail, 15);
  }

  // Recent form: last 20 (min 15 graded)
  const recent = [...picks].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 20);
  const [rw, rl, rp] = tally(recent);
  add("Last 20 picks", rw, rl, rp, "recent form", 15);

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
          <a href="/track-record" className="text-gold hover:text-goldsoft">
            Full record →
          </a>
        </p>
      </div>
    </section>
  );
}
