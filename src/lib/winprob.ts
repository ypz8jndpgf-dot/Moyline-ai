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
 */

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

/**
 * Win probability (0–1, unrounded) for a priced play: the feed's
 * explicit win_prob when present, else the fair-price probability
 * (price shifted by edge_cents), else the price's own implied
 * probability. Null when nothing usable exists.
 */
export function winProbFraction(input: WinEdgeInput): number | null {
  if (typeof input.win_prob === "number" && isFinite(input.win_prob)) {
    const p = input.win_prob / 100;
    if (p > 0 && p < 1) return p;
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
    return impliedProbFraction(fair);
  }
  return impliedProbFraction(american);
}

/** Full win% + edge info for a priced play, or null when unusable. */
export function winEdgeInfo(input: WinEdgeInput): WinEdgeInfo | null {
  const frac = winProbFraction(input);
  if (frac === null) return null;
  const edge =
    typeof input.edge_cents === "number" && isFinite(input.edge_cents)
      ? input.edge_cents
      : null;
  const hasModelProb =
    (typeof input.win_prob === "number" && isFinite(input.win_prob)) ||
    (edge !== null && edge !== 0);
  return {
    winProb: Math.round(frac * 100),
    edgeCents: edge,
    impliedOnly: !hasModelProb,
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
 * product of the legs' win probabilities. Null when any leg is
 * unusable — never a partial product dressed up as the ticket's.
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
