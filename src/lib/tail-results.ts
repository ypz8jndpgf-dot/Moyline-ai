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
