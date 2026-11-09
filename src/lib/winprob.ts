/**
 * Model win probability + edge — the single shared display helper for
 * every member-facing surface (2026-11-08 display swap: the 1–5
 * confidence rating stays in the DATA — feed fields, gates, sorting,
 * grading — but members see win% + edge instead).
 *
 * The math is the card's own fair-price convention, nothing new
 * invented: the published edge in cents is the gap between the market
 * price and our fair price, so fair odds = american − edge_cents (the
 * edge shifts the odds in the bettor's favor — favorites get more
 * negative, dogs get less positive), and the win probability is the
 * fair odds' implied probability. When a feed carries an explicit
 * `win_prob` it wins. With no edge, the win% is the price's own implied
 * probability — an "implied" number, labeled as such (board legs).
 *
 * CALIBRATION FIT (2026-11-08, owner decision): MODEL probabilities —
 * feed `win_prob` or fair-price-derived — are passed through the
 * isotonic recalibration fit in src/lib/calibration.json (fitted by
 * scripts/build-calibration.py on the graded record) before display,
 * so the % a member sees is what picks at that level have actually
 * done. Market-implied probabilities (no model edge behind them —
 * board legs) are NOT fitted. Edge display is a price fact and is
 * never fitted.
 *
 * ⚠️ DISPLAY ONLY. The fit lives here, at render, on purpose: the
 * feed's `win_prob` stays RAW, and gates, sorting, grading and every
 * algo input keep using raw model numbers. Do not "fix" this by
 * fitting upstream or by reading fitted values back into logic — if a
 * consumer needs the raw probability, it should read the feed fields,
 * not this helper.
 */
import { CALIBRATION } from "./calibration";

export type WinEdgeInput = {
  price?: string | null;
  edge_cents?: number | null;
  win_prob?: number | null;
};

export type WinEdgeInfo = {
  /** Whole-percent win probability. */
  winProb: number;
  edgeCents: number | null;
  /** True when winProb is just the raw price implication (no model edge behind it). */
  impliedOnly: boolean;
};

/**
 * American odds from a price string: "-118 (DraftKings)" → -118,
 * "+150" → 150, "-3.5 (-110)" → -110. Same scan card-utils uses — the
 * first signed run of 3+ digits is the odds (a spread point like -3.5
 * never matches). Null when there's no usable odds number.
 */
export function parseAmericanOdds(price?: string | null): number | null {
  if (!price) return null;
  const m = price.match(/([+-]?\d{3,})/);
  return m ? parseInt(m[1], 10) : null;
}

/** Implied probability (0–1, unrounded) of American odds. */
export function impliedProbFraction(american: number): number {
  return american < 0
    ? -american / (-american + 100)
    : 100 / (american + 100);
}

const FIT_STEPS = CALIBRATION.fit?.breakpoints ?? [];

/**
 * Apply the calibration fit to a RAW model win% (0–100): the fitted %
 * of the first breakpoint whose `upTo` >= the raw %. Returns the raw %
 * unchanged when no fit is loaded. Fitted values come clamped to
 * [5, 95] from the build script; the lookup can only return a step's
 * fitted value, so monotonicity holds by construction.
 */
export function fittedWinProb(rawPct: number): number {
  if (!FIT_STEPS.length || !isFinite(rawPct)) return rawPct;
  for (const s of FIT_STEPS) {
    if (rawPct <= s.upTo) return s.fitted;
  }
  return FIT_STEPS[FIT_STEPS.length - 1].fitted;
}

/**
 * The raw (unfitted) probability for a priced play, flagged by kind:
 * `isModel` when it comes from the model (feed win_prob, or the
 * fair-price probability behind a stated edge) — those get the
 * calibration fit at display; not-model when it's the price's own
 * implied probability — those never do.
 */
function rawWinProb(
  input: WinEdgeInput
): { frac: number; isModel: boolean } | null {
  if (typeof input.win_prob === "number" && isFinite(input.win_prob)) {
    const p = input.win_prob / 100;
    if (p > 0 && p < 1) return { frac: p, isModel: true };
  }
  const american = parseAmericanOdds(input.price);
  if (american === null || american === 0) return null;
  const edge =
    typeof input.edge_cents === "number" && isFinite(input.edge_cents)
      ? input.edge_cents
      : null;
  if (edge !== null && edge !== 0) {
    const fair = american - edge;
    if (fair === 0) return null;
    return { frac: impliedProbFraction(fair), isModel: true };
  }
  return { frac: impliedProbFraction(american), isModel: false };
}

/**
 * DISPLAY win probability (0–1, unrounded) for a priced play: the
 * feed's explicit win_prob when present, else the fair-price
 * probability (price shifted by edge_cents), else the price's own
 * implied probability — with the calibration fit applied to the model
 * cases (see header). Null when nothing usable exists. This is a
 * render-time number; never feed it back into gates or grading.
 */
export function winProbFraction(input: WinEdgeInput): number | null {
  const raw = rawWinProb(input);
  if (raw === null) return null;
  return raw.isModel ? fittedWinProb(raw.frac * 100) / 100 : raw.frac;
}

/**
 * The RAW (unfitted) model win% for a priced play, whole percent — null
 * when the play has no model probability (implied-only). Exists for
 * the share-link round-trip: ShareButton puts this raw % in the `w`
 * param and /share + /api/share-card re-derive the display through
 * winEdgeInfo, so the calibration fit is applied exactly once, there.
 * (Putting the fitted % in `w` instead would double-fit on arrival.)
 */
export function rawModelWinProb(input: WinEdgeInput): number | null {
  const raw = rawWinProb(input);
  if (raw === null || !raw.isModel) return null;
  return Math.round(raw.frac * 100);
}

/** Full win% + edge info for a priced play, or null when unusable. */
export function winEdgeInfo(input: WinEdgeInput): WinEdgeInfo | null {
  const raw = rawWinProb(input);
  if (raw === null) return null;
  const edge =
    typeof input.edge_cents === "number" && isFinite(input.edge_cents)
      ? input.edge_cents
      : null;
  const displayPct = raw.isModel ? fittedWinProb(raw.frac * 100) : raw.frac * 100;
  return {
    winProb: Math.round(displayPct),
    edgeCents: edge,
    impliedOnly: !raw.isModel,
  };
}

/**
 * The standard member-facing badge: "58% · +35¢ edge" with an edge,
 * "58%" for a model probability without an edge figure, "52% implied"
 * for a raw price implication (board legs). Null when unusable.
 */
export function formatWinEdge(info: WinEdgeInfo | null): string | null {
  if (!info) return null;
  if (info.edgeCents !== null && info.edgeCents !== 0) {
    const e = info.edgeCents > 0 ? `+${info.edgeCents}` : `${info.edgeCents}`;
    return `${info.winProb}% · ${e}¢ edge`;
  }
  return info.impliedOnly ? `${info.winProb}% implied` : `${info.winProb}%`;
}

/** Badge string straight from a pick-shaped object. */
export function pickWinEdge(p: WinEdgeInput): string | null {
  return formatWinEdge(winEdgeInfo(p));
}

/**
 * Combined win probability (whole %) for a multi-leg ticket: the
 * product of the legs' DISPLAY win probabilities (model legs enter
 * calibration-fitted, via winProbFraction; implied-only legs enter at
 * their raw price implication). Null when any leg is unusable — never
 * a partial product dressed up as the ticket's.
 */
export function combinedWinProb(legs: WinEdgeInput[]): number | null {
  if (!legs.length) return null;
  let prod = 1;
  for (const leg of legs) {
    const frac = winProbFraction(leg);
    if (frac === null) return null;
    prod *= frac;
  }
  return Math.round(prod * 100);
}
