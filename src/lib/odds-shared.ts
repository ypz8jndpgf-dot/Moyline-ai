/**
 * Pure, dependency-free odds helpers + types.
 * Safe to import from client components.
 */

export interface BookOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface BookMarket {
  key: string;
  outcomes: BookOutcome[];
}

export interface BookOdds {
  key: string;
  title: string;
  markets: BookMarket[];
}

export interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: BookOdds[];
}

export interface DeltaInfo {
  openPoint?: number;
  openPrice?: number;
  curPoint?: number;
  curPrice?: number;
  pointDelta?: number;
  priceDelta?: number;
  moved: boolean;
  steam: boolean;
}

export function computeDelta(
  open: { price: number; point?: number } | undefined,
  cur: { price: number; point?: number }
): DeltaInfo {
  if (!open) return { moved: false, steam: false };
  const pointDelta =
    open.point !== undefined && cur.point !== undefined
      ? Math.round((cur.point - open.point) * 100) / 100
      : undefined;
  const priceDelta = cur.price - open.price;
  const moved = (pointDelta !== undefined && pointDelta !== 0) || priceDelta !== 0;
  const steam =
    (pointDelta !== undefined && Math.abs(pointDelta) >= 1.5) || Math.abs(priceDelta) >= 40;
  return {
    openPoint: open.point,
    openPrice: open.price,
    curPoint: cur.point,
    curPrice: cur.price,
    pointDelta,
    priceDelta,
    moved,
    steam,
  };
}

export function fmtAmerican(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function payout(american: number): number {
  return american > 0 ? american / 100 : 100 / Math.abs(american);
}

/** Best (highest-payout) price per outcome across books. Returns book key. */
export function bestPriceBook(books: { key: string; price: number }[]): string | null {
  if (books.length === 0) return null;
  let best = books[0];
  for (const b of books) {
    if (payout(b.price) > payout(best.price)) best = b;
  }
  return best.key;
}

export const BOOK_LABELS: Record<string, string> = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  betmgm: "BetMGM",
  caesars: "Caesars",
};

export const SPORT_LABELS: Record<string, string> = {
  americanfootball_nfl: "NFL",
  americanfootball_ncaaf: "CFB",
  icehockey_nhl: "NHL",
  basketball_nba: "NBA",
  baseball_mlb: "MLB",
  basketball_wnba: "WNBA",
  soccer_usa_mls: "MLS",
  soccer_epl: "EPL",
  soccer_spain_la_liga: "La Liga",
  soccer_germany_bundesliga: "Bundesliga",
  soccer_italy_serie_a: "Serie A",
  soccer_france_ligue_1: "Ligue 1",
  soccer_uefa_champs_league: "UCL",
};
