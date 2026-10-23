import { getTrackRecord, type TrackPick } from "@/lib/store";

/**
 * Showcase record stats — the single computation behind the homepage proof
 * strip and the Featured Record block. Mirrors the tally logic already used
 * by FeaturedPlays (★ record) and GoldenRun (record since the Oct 16 algo
 * recalibration) so every surface shows identical numbers from the same
 * track-record source (Redis `moyline:track-record` via getTrackRecord).
 *
 * Honesty floors (standing site rules):
 * - ★ stat hides when the ★ record is below .500.
 * - Since-Oct-16 stat hides below a 55% win rate (and under 5 decisions).
 * - Last-7-days stat hides below .500 (and under 5 decisions).
 * - The all-time record always shows — the full history is the product.
 */

export const RECAL_DATE = "2026-10-16";

export interface RecordStat {
  w: number;
  l: number;
  p: number;
  /** Win% over decided games (pushes excluded), null when no decisions. */
  pct: number | null;
}

export interface ShowcaseRecords {
  allTime: RecordStat;
  stars: RecordStat;
  sinceRecal: RecordStat;
  last7: RecordStat;
  showStars: boolean;
  showSinceRecal: boolean;
  showLast7: boolean;
}

function tally(picks: TrackPick[]): RecordStat {
  const w = picks.filter((p) => p.result === "Win").length;
  const l = picks.filter((p) => p.result === "Loss").length;
  const p = picks.filter((p) => p.result === "Push").length;
  const pct = w + l > 0 ? (w / (w + l)) * 100 : null;
  return { w, l, p, pct };
}

/** "YYYY-MM-DD" in America/New_York, `daysAgo` days before today ET. */
function etDateString(daysAgo: number): string {
  const todayET = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  const d = new Date(`${todayET}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export async function getShowcaseRecords(): Promise<ShowcaseRecords> {
  const rec = await getTrackRecord();
  const graded = rec.picks.filter((p) => p.result !== "Pending");

  // All-time — every graded pick ever.
  const allTime = tally(graded);

  // ★ Featured plays — same filter as FeaturedPlays.
  const stars = tally(graded.filter((p) => p.star));
  const showStars = stars.w + stars.l > 0 && stars.pct !== null && stars.pct >= 50;

  // Since the Oct 16 recalibration — same filter as GoldenRun
  // (decided games only; pushes never enter the tally).
  const sinceRecal = tally(
    rec.picks.filter(
      (p) => p.date >= RECAL_DATE && (p.result === "Win" || p.result === "Loss")
    )
  );
  const sinceTotal = sinceRecal.w + sinceRecal.l;
  const showSinceRecal =
    sinceTotal >= 5 && sinceRecal.pct !== null && sinceRecal.pct >= 55;

  // Last 7 days (today ET + previous 6 days), graded picks only.
  const cutoff = etDateString(6);
  const last7 = tally(graded.filter((p) => p.date >= cutoff));
  const showLast7 = last7.w + last7.l >= 5 && last7.pct !== null && last7.pct >= 50;

  return { allTime, stars, sinceRecal, last7, showStars, showSinceRecal, showLast7 };
}

/** "193–197" or "193–197–6" when pushes exist. */
export function formatRecord(s: RecordStat): string {
  return s.p > 0 ? `${s.w}–${s.l}–${s.p}` : `${s.w}–${s.l}`;
}

export function formatPct(s: RecordStat): string | null {
  return s.pct !== null ? `${s.pct.toFixed(1)}%` : null;
}
