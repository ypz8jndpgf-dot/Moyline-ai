import { getTrackRecord, type TrackPick } from "@/lib/store";
import { classifyPick } from "@/lib/records";

/**
 * Scrolling ticker tape of live track-record highlights.
 * Fully dynamic: any segment clearing 50% with enough picks shows up automatically.
 * Pure CSS animation, no JS needed.
 *
 * Play-type segments MUST use classifyPick (the shared classifier behind
 * /track-record) — never substring matchers. The old includes("ml")
 * matcher produced a Moneylines tally that contradicted /track-record
 * (69-60 vs 73-59-1; showcase audit, 2026-10-27).
 */

type Segment = { label: string; w: number; l: number };

function collectSegments(picks: TrackPick[]): Segment[] {
  const segments: Segment[] = [];
  const tally = (list: typeof picks): [number, number] => [
    list.filter((p) => p.result === "Win").length,
    list.filter((p) => p.result === "Loss").length,
  ];

  // By sport (min 15 graded — showcase segment floor)
  const bySport = new Map<string, typeof picks>();
  for (const p of picks) {
    const arr = bySport.get(p.sport) || [];
    arr.push(p);
    bySport.set(p.sport, arr);
  }
  // Pulled by user decision 2026-11-05: the daily showcase audit flagged
  // the NBA segment below the showcase floors (12-12, 50.0%, -1.1u —
  // neither ≥55% win% nor positive units). Pulled from the ticker only;
  // NBA picks stay fully visible on /track-record. Reinstate only on the
  // user's approval.
  //
  // CFB and NHL added by user decision 2026-11-11 (post-reset showcase
  // audit): on the Oct 16 baseline both sat at 50.0% with negative
  // units (CFB 8-8, -0.7u; NHL 21-21, -2.9u) — failing both floor
  // prongs. Same rule: ticker only, full segments stay on
  // /track-record, reinstate only on the user's approval.
  const PULLED_SPORTS = new Set(["NBA", "CFB", "NHL"]);

  for (const [sport, list] of bySport) {
    if (PULLED_SPORTS.has(sport.toUpperCase())) continue;
    const [w, l] = tally(list);
    if (w + l >= 15 && w / (w + l) >= 0.5)
      segments.push({ label: sport.toUpperCase(), w, l });
  }

  // By play type (min 15 graded — showcase segment floor)
  const types: [string, (p: TrackPick) => boolean][] = [
    ["UNDERS", (p) => classifyPick(p) === "Total" && /\bunder\b/i.test(p.play) && !/team total/i.test(p.play)],
    ["OVERS", (p) => classifyPick(p) === "Total" && /\bover\b/i.test(p.play) && !/team total/i.test(p.play)],
    ["MONEYLINES", (p) => classifyPick(p) === "Moneyline"],
    ["SPREADS", (p) => classifyPick(p) === "Spread"],
  ];
  // Pulled by user decision 2026-11-09 (supersedes the 2026-10-31
  // "leave it as is" exception): MONEYLINES sat at 82-71, 53.6%, -2.4u —
  // failing both showcase floor prongs (≥55% win% or positive units).
  // Pulled from the ticker only; the segment stays fully visible on
  // /track-record. Reinstate only on the user's approval.
  //
  // UNDERS and OVERS added by user decision 2026-11-11 (post-reset
  // showcase audit): UNDERS sat at 15-15, 50.0%, -1.0u and OVERS at
  // 6-6, 50.0%, -0.7u on the Oct 16 baseline — both failing both floor
  // prongs. Same rule: ticker only, full segments stay on
  // /track-record, reinstate only on the user's approval.
  const PULLED_TYPES = new Set(["MONEYLINES", "UNDERS", "OVERS"]);

  for (const [label, match] of types) {
    if (PULLED_TYPES.has(label)) continue;
    const list = picks.filter(match);
    const [w, l] = tally(list);
    if (w + l >= 15 && w / (w + l) >= 0.5) segments.push({ label, w, l });
  }

  // Recent form: last 10 graded
  const recent = [...picks].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
  const [rw, rl] = tally(recent);
  if (rw + rl >= 8 && rw / (rw + rl) >= 0.5)
    segments.push({ label: "LAST 10", w: rw, l: rl });

  // Sort by win% desc so the hottest shows first
  segments.sort((a, b) => b.w / (b.w + b.l) - a.w / (a.w + a.l));
  return segments;
}

export default async function TrackTicker() {
  const rec = await getTrackRecord();
  const picks = rec.picks.filter((p) => p.result !== "Pending");

  if (picks.length < 20) return null;

  const items: string[] = [];

  // Overall record always leads
  const w = rec.totals.w;
  const l = rec.totals.l;
  const pct = w + l > 0 ? ((w / (w + l)) * 100).toFixed(1) : "0";
  items.push(`★ ALL-TIME ${w}-${l} (${pct}%)`);

  for (const s of collectSegments(picks)) {
    const sp = ((s.w / (s.w + s.l)) * 100).toFixed(0);
    items.push(`${s.label} ${s.w}-${s.l} (${sp}%)`);
  }

  if (items.length < 2) return null;

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
