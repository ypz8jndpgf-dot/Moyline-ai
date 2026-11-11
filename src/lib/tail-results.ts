import { pickUnits } from "@/lib/records";
import type { TrackPick } from "@/lib/store";
import type { Tail } from "@/lib/tails";

/**
 * Shared matching between a member's tailed pick and the graded track
 * record. /my-tails uses this to grade the member's own list; the
 * tail-alerts check uses the same match for settled-tail pushes, so the
 * push can never disagree with what the member sees on the page.
 */
export type GradedTailPick = Pick<
  TrackPick,
  "game" | "play" | "date" | "result" | "final" | "line"
>;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Match a tailed pick to its track-record entry (null while ungraded). */
export function gradeTail(
  tail: Pick<Tail, "game" | "play" | "date">,
  picks: readonly GradedTailPick[]
): GradedTailPick | null {
  const tg = norm(tail.game);
  const tp = norm(tail.play);
  return (
    picks.find((p) => {
      if (p.date !== tail.date) return false;
      if (norm(p.play) !== tp) return false;
      const pg = norm(p.game);
      // Every word of the tail's game must appear in the record's game (or vice versa).
      const tw = tg.split(" ").filter((w) => w.length > 2);
      const pw = pg.split(" ").filter((w) => w.length > 2);
      return tw.every((w) => pg.includes(w)) || pw.every((w) => tg.includes(w));
    }) || null
  );
}

export interface TailsDaySummary {
  w: number;
  l: number;
  p: number;
  /** Units over the day's graded tails — null unless every graded tail
   *  that day carries a price (the daily-results rule: the figure is
   *  exact or absent, never partial). */
  units: number | null;
}

/**
 * A member's graded record on one date's tails (optimization #69, for
 * the "Your tails went X–Y" line in the morning results email). Uses the
 * same gradeTail/tailUnits matching as /my-tails, so the email can never
 * disagree with the page. Null when none of that day's tails are graded.
 */
export function summarizeTailsForDate(
  tails: readonly Tail[],
  picks: readonly GradedTailPick[],
  date: string
): TailsDaySummary | null {
  let w = 0;
  let l = 0;
  let p = 0;
  let units = 0;
  let priced = 0;
  let gradedCount = 0;
  for (const t of tails) {
    if (t.date !== date) continue;
    const result = gradeTail(t, picks);
    if (!result || result.result === "Pending") continue;
    gradedCount++;
    if (result.result === "Win") w++;
    else if (result.result === "Loss") l++;
    else p++;
    const u = tailUnits(t, result);
    if (u !== null) {
      priced++;
      units += u;
    }
  }
  if (gradedCount === 0) return null;
  return { w, l, p, units: priced === gradedCount ? units : null };
}

/**
 * Units for a settled tail at the price the member tailed at — flat 1u
 * risked, the same convention /my-tails has always shown (#32). Falls
 * back to the graded record's own line when the tail carries no
 * parseable price. Null when the pick is unsettled or unpriced.
 */
export function tailUnits(
  tail: Pick<Tail, "play" | "price">,
  result: GradedTailPick | null
): number | null {
  if (!result || result.result === "Pending") return null;
  const american = (tail.price || "").match(/([+-]\d{2,4})/);
  if (american) {
    return pickUnits({
      line: american[1],
      play: tail.play,
      result: result.result,
    } as TrackPick);
  }
  return pickUnits(result as TrackPick);
}
