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

/* ------------------------------------------------------------------ */
/* Units — profit at the prices the picks were published at.           */
/* 1 unit risked per bet: win pays the price profit, loss −1, push 0.  */
/* Prices live in the pick's `line` field (American or decimal); a few */
/* early picks carry the price inside the play text, and a few have    */
/* no recorded price at all — those are excluded and counted.          */
/* ------------------------------------------------------------------ */

/** Profit per 1 unit risked if the bet wins, or null when unpriced. */
export function pickPriceProfit(p: TrackPick): number | null {
  const line = (p.line || "").trim();

  const american = line.match(/^([+-])(\d+)$/);
  if (american) {
    const v = parseInt(american[2], 10) * (american[1] === "+" ? 1 : -1);
    return v > 0 ? v / 100 : 100 / Math.abs(v);
  }
  if (/^\d+\.\d+$/.test(line)) {
    const dec = parseFloat(line);
    if (dec > 1 && dec <= 20) return dec - 1;
  }
  const frac = line.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1], 10) / parseInt(frac[2], 10);
  const range = line.match(/^([+-]\d+)\/([+-]\d+)$/);
  if (range) {
    const v = parseInt(range[1], 10);
    return v > 0 ? v / 100 : 100 / Math.abs(v);
  }
  // Price embedded in the play text: "Win to Nil @ 2.10", "Astros +130 ML".
  const atDec = p.play.match(/@\s*(\d+\.\d+)/);
  if (atDec) {
    const dec = parseFloat(atDec[1]);
    if (dec > 1) return dec - 1;
  }
  const ml = p.play.match(/([+-]\d{2,3})\s*ML/i);
  if (ml) {
    const v = parseInt(ml[1], 10);
    return v > 0 ? v / 100 : 100 / Math.abs(v);
  }
  return null;
}

/** Units won/lost on one graded pick; null when it has no recorded price. */
export function pickUnits(p: TrackPick): number | null {
  if (p.result === "Pending") return null;
  const price = pickPriceProfit(p);
  if (price === null) return null;
  if (p.result === "Win") return price;
  if (p.result === "Loss") return -1;
  return 0;
}

export interface UnitsInfo {
  /** Total units profit over priced graded picks. */
  units: number;
  /** Graded picks with a recorded price (the units denominator). */
  priced: number;
  /** All graded picks in the set, priced or not. */
  graded: number;
  /** Return on risk: units / priced, as a percent. Null when unpriced. */
  roiPct: number | null;
}

export function unitsFor(picks: TrackPick[]): UnitsInfo {
  let units = 0;
  let priced = 0;
  let graded = 0;
  for (const p of picks) {
    if (p.result === "Pending") continue;
    graded++;
    const u = pickUnits(p);
    if (u !== null) {
      priced++;
      units += u;
    }
  }
  return {
    units,
    priced,
    graded,
    roiPct: priced > 0 ? (units / priced) * 100 : null,
  };
}

export interface StatWithUnits extends RecordStat {
  units: UnitsInfo;
}

function tallyWithUnits(picks: TrackPick[]): StatWithUnits {
  return { ...tally(picks), units: unitsFor(picks) };
}

/** "+3.6u" / "-29.8u" — one decimal, sign always shown. */
export function formatUnits(u: number): string {
  return `${u >= 0 ? "+" : "-"}${Math.abs(u).toFixed(1)}u`;
}

export function formatRoi(roiPct: number | null): string | null {
  if (roiPct === null) return null;
  return `${roiPct >= 0 ? "+" : "-"}${Math.abs(roiPct).toFixed(1)}% ROI`;
}

/* ------------------------------------------------------------------ */
/* Pick classification — the track record stores the play as text, so  */
/* type and prop market are derived from it with fixed rules.          */
/* ------------------------------------------------------------------ */

export type PickType =
  | "Moneyline"
  | "Spread"
  | "Total"
  | "Player prop"
  | "Parlay"
  | "Teaser"
  | "Other market";

const TYPE_LABELS: Record<PickType, string> = {
  Moneyline: "Moneylines",
  Spread: "Spreads",
  Total: "Totals",
  "Player prop": "Player props",
  Parlay: "Parlays",
  Teaser: "Teasers",
  "Other market": "Other markets",
};

export function pickTypeLabel(t: PickType): string {
  return TYPE_LABELS[t];
}

const PROP_STAT_WORDS = [
  "rec yds", "receiving", "rush yds", "rushing", "pass yds", "passing",
  "tds", "strikeout", "points", "rebounds", "assists", "shots", "saves",
  "goals", "hits", "total bases", "tackles", "steals", "blocks",
  "anytime td", "pts", "pass att", "receptions", "completions",
  "interceptions",
];

export function classifyPick(p: TrackPick): PickType {
  const play = (p.play || "").trim();
  const low = play.toLowerCase();
  if (low.includes("teaser")) return "Teaser";
  if (low.includes("parlay")) return "Parlay";
  if (low.includes("team total")) return "Total";
  const hasStat = PROP_STAT_WORDS.some((s) => low.includes(s)) || /\bks\b/.test(low) || /(^|\s)ER(\s|$)/.test(play);
  if (hasStat) return "Player prop";
  if (/\b(over|under)\b/.test(low)) {
    return /^ *(over|under) +[\d.]+ *$/.test(low) ? "Total" : "Player prop";
  }
  if (
    low.includes("btts") || low.includes("win to nil") || low.includes("draw") ||
    low.includes("double chance") || low.includes("dnb") || low.includes("nrfi") ||
    low.includes("no runs first") || low.includes("goes the distance") ||
    / x2$/.test(low)
  ) {
    return "Other market";
  }
  if (/\bml\b/i.test(play)) return "Moneyline";
  // Trailing 3-digit integer is a moneyline price, not a spread: "Ducks +112".
  if (/[+-]\d{3,}\s*$/.test(play)) return "Moneyline";
  if (/[+-]\d+(\.\d+)?\s*(ah)?\s*$/i.test(play) || low.includes(" ah")) return "Spread";
  return "Other market";
}

const PROP_MARKETS: [RegExp, string][] = [
  [/rec(eiving)? yds|receiving yards/i, "Receiving yards"],
  [/rush(ing)? yds|rushing yards/i, "Rushing yards"],
  [/pass(ing)? yds|passing yards/i, "Passing yards"],
  [/passing tds|pass tds/i, "Passing TDs"],
  [/anytime td/i, "Anytime TD"],
  [/strikeouts|\bks\b/i, "Strikeouts"],
  [/pass att/i, "Pass attempts"],
  [/\brec\b|receptions/i, "Receptions"],
  [/rebounds/i, "Rebounds"],
  [/assists/i, "Assists"],
  [/\bpts\b|points/i, "Points"],
  [/total bases/i, "Total bases"],
  [/completions/i, "Completions"],
  [/interceptions/i, "Interceptions"],
  [/tackles/i, "Tackles"],
  [/steals/i, "Steals"],
  [/blocks/i, "Blocks"],
  [/saves/i, "Saves"],
  [/shots/i, "Shots on goal"],
  [/hits/i, "Hits"],
  [/goals/i, "Goals"],
  [/(^|\s)ER(\s|$)/, "Pitcher earned runs"],
];

/** Prop market for a player-prop pick, e.g. "Receiving yards". */
export function propMarket(p: TrackPick): string {
  for (const [re, label] of PROP_MARKETS) {
    if (re.test(p.play)) return label;
  }
  return "Other props";
}

export function sportLabel(sport: string): string {
  return sport && sport.trim() ? sport : "Unspecified";
}

/* ------------------------------------------------------------------ */
/* Segments — every cut of the record, used on /track-record in full   */
/* and by the featured-metric curation as candidates.                  */
/* ------------------------------------------------------------------ */

export interface SegmentRow {
  label: string;
  stat: StatWithUnits;
  decisions: number;
}

function segmentRows(
  picks: TrackPick[],
  keyFn: (p: TrackPick) => string
): SegmentRow[] {
  const groups = new Map<string, TrackPick[]>();
  for (const p of picks) {
    const k = keyFn(p);
    const arr = groups.get(k);
    if (arr) arr.push(p);
    else groups.set(k, [p]);
  }
  const rows: SegmentRow[] = [];
  for (const [label, ps] of groups) {
    const stat = tallyWithUnits(ps);
    rows.push({ label, stat, decisions: stat.w + stat.l });
  }
  rows.sort((a, b) => b.decisions - a.decisions || b.stat.w - a.stat.w);
  return rows;
}

/* ------------------------------------------------------------------ */
/* Featured-metric curation — the daily "management" layer. The data   */
/* changes daily; the selection rules are fixed. Homepage surfaces     */
/* feature only true, labeled stats that clear their floors; the full  */
/* record (every segment, win or lose) always lives on /track-record.  */
/* ------------------------------------------------------------------ */

export interface FeaturedMetric {
  key: string;
  label: string;
  note: string;
  stat: StatWithUnits;
  decisions: number;
}

export interface FeaturedMetrics {
  anchor: StatWithUnits;
  stars: StatWithUnits;
  showStars: boolean;
  sinceRecal: StatWithUnits;
  showSinceRecal: boolean;
  /** Ranked eligible story stats, best first (win%, then units, then decisions). */
  stories: FeaturedMetric[];
  /** ProofStrip third slot: since-recal when eligible, else best window. */
  proofThird: FeaturedMetric | null;
}

function rankCompare(a: FeaturedMetric, b: FeaturedMetric): number {
  const pa = a.stat.pct ?? -1;
  const pb = b.stat.pct ?? -1;
  if (pb !== pa) return pb - pa;
  if (b.stat.units.units !== a.stat.units.units)
    return b.stat.units.units - a.stat.units.units;
  return b.decisions - a.decisions;
}

/** Window floor: ≥10 decisions and (win% ≥ 55 or positive units). */
function windowEligible(s: StatWithUnits): boolean {
  const dec = s.w + s.l;
  return dec >= 10 && ((s.pct !== null && s.pct >= 55) || s.units.units > 0);
}

/** Segment floor: ≥15 decisions and (win% ≥ 55 or positive units). */
function segmentEligible(s: StatWithUnits): boolean {
  const dec = s.w + s.l;
  return dec >= 15 && ((s.pct !== null && s.pct >= 55) || s.units.units > 0);
}

export async function getFeaturedMetrics(): Promise<FeaturedMetrics> {
  const rec = await getTrackRecord();
  const graded = rec.picks.filter((p) => p.result !== "Pending");

  const anchor = tallyWithUnits(graded);

  const stars = tallyWithUnits(graded.filter((p) => p.star));
  const showStars = stars.w + stars.l > 0 && stars.pct !== null && stars.pct >= 50;

  const sinceRecal = tallyWithUnits(
    graded.filter((p) => p.date >= RECAL_DATE)
  );
  const showSinceRecal =
    sinceRecal.w + sinceRecal.l >= 5 &&
    sinceRecal.pct !== null &&
    sinceRecal.pct >= 55;

  const last30 = tallyWithUnits(graded.filter((p) => p.date >= etDateString(29)));
  const last7 = tallyWithUnits(graded.filter((p) => p.date >= etDateString(6)));

  const candidates: (FeaturedMetric & {
    sport?: string;
    type?: PickType;
    window?: boolean;
  })[] = [];

  if (showStars) {
    candidates.push({
      key: "stars",
      label: "★ Featured plays",
      note: "Biggest-edge plays only",
      stat: stars,
      decisions: stars.w + stars.l,
    });
  }
  if (showSinceRecal) {
    candidates.push({
      key: "sinceRecal",
      label: "Since the Oct 16 rebuild",
      note: "Post-recalibration record",
      stat: sinceRecal,
      decisions: sinceRecal.w + sinceRecal.l,
      window: true,
    });
  }
  if (windowEligible(last30)) {
    candidates.push({
      key: "last30",
      label: "Last 30 days",
      note: "Rolling month of form",
      stat: last30,
      decisions: last30.w + last30.l,
      window: true,
    });
  }
  if (windowEligible(last7)) {
    candidates.push({
      key: "last7",
      label: "Last 7 days",
      note: "Current form",
      stat: last7,
      decisions: last7.w + last7.l,
      window: true,
    });
  }

  // Best eligible segment per family: sport, pick type, sport × type.
  const bestOf = (rows: SegmentRow[]): SegmentRow | null => {
    const elig = rows.filter((r) => segmentEligible(r.stat));
    if (elig.length === 0) return null;
    elig.sort((a, b) =>
      rankCompare(
        { key: "", label: a.label, note: "", stat: a.stat, decisions: a.decisions },
        { key: "", label: b.label, note: "", stat: b.stat, decisions: b.decisions }
      )
    );
    return elig[0];
  };

  const sportRows = segmentRows(graded, (p) => sportLabel(p.sport));
  const typeRows = segmentRows(graded, (p) => pickTypeLabel(classifyPick(p)));
  const comboRows = segmentRows(
    graded,
    (p) => `${sportLabel(p.sport)}|${classifyPick(p)}`
  );

  const bestSport = bestOf(sportRows);
  if (bestSport) {
    candidates.push({
      key: `sport:${bestSport.label}`,
      label: bestSport.label,
      note: "Best sport · all plays",
      stat: bestSport.stat,
      decisions: bestSport.decisions,
      sport: bestSport.label,
    });
  }
  const bestTypeRow = bestOf(typeRows);
  if (bestTypeRow) {
    const t = (Object.keys(TYPE_LABELS) as PickType[]).find(
      (k) => TYPE_LABELS[k] === bestTypeRow.label
    );
    candidates.push({
      key: `type:${bestTypeRow.label}`,
      label: bestTypeRow.label,
      note: "Best play type · all sports",
      stat: bestTypeRow.stat,
      decisions: bestTypeRow.decisions,
      type: t,
    });
  }
  const bestCombo = bestOf(comboRows);
  if (bestCombo) {
    const [sport, type] = bestCombo.label.split("|") as [string, PickType];
    candidates.push({
      key: `combo:${bestCombo.label}`,
      label: `${sport} ${pickTypeLabel(type).toLowerCase()}`,
      note: "Best segment · sport × play type",
      stat: bestCombo.stat,
      decisions: bestCombo.decisions,
      sport,
      type,
    });
  }

  candidates.sort(rankCompare);

  // Greedy selection without lineage conflicts: a featured sport and a
  // featured sport × type combo for the same sport (or two stats for the
  // same play type) would double-count the same strength.
  const stories: FeaturedMetric[] = [];
  const usedSports = new Set<string>();
  const usedTypes = new Set<PickType>();
  for (const c of candidates) {
    if (c.sport && usedSports.has(c.sport)) continue;
    if (c.type && usedTypes.has(c.type)) continue;
    if (c.sport) usedSports.add(c.sport);
    if (c.type) usedTypes.add(c.type);
    stories.push({
      key: c.key,
      label: c.label,
      note: c.note,
      stat: c.stat,
      decisions: c.decisions,
    });
  }

  const sinceMetric = stories.find((s) => s.key === "sinceRecal") ?? null;
  const proofThird =
    sinceMetric ??
    stories.find(
      (s) => s.key === "last7" || s.key === "last30"
    ) ??
    null;

  return { anchor, stars, showStars, sinceRecal, showSinceRecal, stories, proofThird };
}

/* ------------------------------------------------------------------ */
/* /track-record analytics — full disclosure: units band data, the     */
/* cumulative-units trajectory, and every segment (win or lose).       */
/* ------------------------------------------------------------------ */

export interface RecordAnalytics {
  recalDate: string;
  allTime: StatWithUnits;
  preRecal: StatWithUnits;
  postRecal: StatWithUnits;
  /** Cumulative units after each date that has graded picks, ascending. */
  trajectory: { date: string; cumUnits: number }[];
  bySport: SegmentRow[];
  byType: SegmentRow[];
  propMarkets: SegmentRow[];
}

export async function getRecordAnalytics(): Promise<RecordAnalytics> {
  const rec = await getTrackRecord();
  const graded = rec.picks.filter((p) => p.result !== "Pending");

  const allTime = tallyWithUnits(graded);
  const preRecal = tallyWithUnits(graded.filter((p) => p.date < RECAL_DATE));
  const postRecal = tallyWithUnits(graded.filter((p) => p.date >= RECAL_DATE));

  // Cumulative units by date (priced picks only; unpriced contribute 0).
  const byDate = new Map<string, number>();
  for (const p of graded) {
    const u = pickUnits(p);
    if (u === null) continue;
    byDate.set(p.date, (byDate.get(p.date) ?? 0) + u);
  }
  const trajectory: { date: string; cumUnits: number }[] = [];
  let cum = 0;
  for (const date of [...byDate.keys()].sort()) {
    cum += byDate.get(date) ?? 0;
    trajectory.push({ date, cumUnits: Math.round(cum * 100) / 100 });
  }

  const bySport = segmentRows(graded, (p) => sportLabel(p.sport));
  const byType = segmentRows(graded, (p) => pickTypeLabel(classifyPick(p)));
  const propMarkets = segmentRows(
    graded.filter((p) => classifyPick(p) === "Player prop"),
    (p) => propMarket(p)
  );

  return {
    recalDate: RECAL_DATE,
    allTime,
    preRecal,
    postRecal,
    trajectory,
    bySport,
    byType,
    propMarkets,
  };
}

/** "193–197" or "193–197–6" when pushes exist. */
export function formatRecord(s: RecordStat): string {
  return s.p > 0 ? `${s.w}–${s.l}–${s.p}` : `${s.w}–${s.l}`;
}

export function formatPct(s: RecordStat): string | null {
  return s.pct !== null ? `${s.pct.toFixed(1)}%` : null;
}
