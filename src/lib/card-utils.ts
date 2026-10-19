import { GameVM, MoverVM } from "./board";
import { FeedPick } from "./picks";

/** "Nevada @ UTEP (CFB)" -> { away: "Nevada", home: "UTEP" }. */
export function parseGameTeams(game: string): { away: string; home: string } | null {
  const m = game.match(/^\s*(.+?)\s+@\s+(.+?)\s*(\(|$)/);
  if (!m) return null;
  return { away: m[1].trim(), home: m[2].trim() };
}

/** Normalize a game label for dedupe: strips rankings ("#19 "), lowercases, collapses spaces. */
export function normalizeGame(game: string): string {
  return norm(game.replace(/#\d+\s*/g, ""));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** True if every word of `short` appears in `full` (order-independent). */
function teamMatches(short: string, full: string): boolean {
  const sWords = norm(short).split(" ").filter(Boolean);
  const fWords = new Set(norm(full).split(" ").filter(Boolean));
  if (sWords.length === 0) return false;
  return sWords.every((w) => fWords.has(w));
}

/** Find the odds-board game matching a feed pick's teams (both sides must match). */
export function findBoardGame(pick: FeedPick, games: GameVM[]): GameVM | null {
  const teams = parseGameTeams(pick.game);
  if (!teams) return null;
  const cands = games.filter(
    (g) => teamMatches(teams.away, g.away) && teamMatches(teams.home, g.home)
  );
  return cands[0] || null;
}

export type BestPrice = { book: string; display: string } | null;

/**
 * Best available price for a feed pick across the board's books.
 * Uses the board's precomputed `best` flags; falls back to the first
 * available cell when no best flag is set.
 */
export function bestPriceForPick(pick: FeedPick, game: GameVM): BestPrice {
  const teams = parseGameTeams(pick.game);
  const market = pick.market;
  const play = (pick.play || "").toLowerCase();

  let cellKey: "spreadAway" | "spreadHome" | "totalOver" | "totalUnder" | "mlAway" | "mlHome" | null = null;

  if (market === "total" || /\bover\b|\bunder\b/.test(play)) {
    cellKey = /\bunder\b/.test(play) ? "totalUnder" : "totalOver";
  } else if (market === "ml" || /\bml\b/.test(play)) {
    if (!teams) return null;
    // Which side is the ML team? Match the team name in the play text.
    const playNorm = norm(play.replace(/\bml\b/g, ""));
    const awayFirst = norm(teams.away).split(" ")[0];
    cellKey = playNorm.includes(awayFirst) ? "mlAway" : "mlHome";
  } else {
    // Spread (default): find the team in the play, e.g. "Nevada -9.5".
    if (!teams) return null;
    const playNorm = norm(play);
    const awayFirst = norm(teams.away).split(" ")[0];
    const homeFirst = norm(teams.home).split(" ")[0];
    if (playNorm.includes(awayFirst)) cellKey = "spreadAway";
    else if (playNorm.includes(homeFirst)) cellKey = "spreadHome";
    else return null;
  }

  let fallback: BestPrice = null;
  for (const b of game.books) {
    const cell = b[cellKey];
    if (!cell) continue;
    if (!fallback) fallback = { book: b.label, display: cell.display };
    if (cell.best) return { book: b.label, display: cell.display };
  }
  return fallback;
}

/** Extract an American-odds number from a price string like "-138" or "(-154)". */
function parseAmerican(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/([+-]?\d{3,})/);
  return m ? parseInt(m[1], 10) : null;
}

function payout(american: number): number {
  return american > 0 ? american / 100 : 100 / Math.abs(american);
}

/**
 * True when the live-board best price is at least as good as the price the
 * card locked in. Hides the badge when the line moved against the play
 * (e.g. card got -138, board now shows -154) so it never contradicts the pick.
 */
export function badgeBeatsPlay(pick: FeedPick, best: BestPrice): boolean {
  if (!best) return false;
  const playPrice = parseAmerican(pick.price);
  const bestPrice = parseAmerican(best.display);
  if (playPrice === null || bestPrice === null) return true; // can't compare — show it
  return payout(bestPrice) >= payout(playPrice);
}

/** Movers (steam) involving a card game's teams. */
export function steamForGame(game: GameVM, movers: MoverVM[]): MoverVM[] {
  const away = norm(game.away);
  const home = norm(game.home);
  return movers.filter((m) => {
    const label = norm(m.game + " " + m.detail);
    const awayHit = away.split(" ").some((w) => w.length > 2 && label.includes(w));
    const homeHit = home.split(" ").some((w) => w.length > 2 && label.includes(w));
    return m.steam && (awayHit || homeHit);
  });
}

/**
 * Merge key for the holistic card: normalized game + market + side.
 * A re-published play at a changed line (e.g. "Penn State -1.5" -> "-2")
 * replaces the earlier one; a different bet on the same game
 * (side vs total) stays as its own entry.
 */
export function mergeKey(p: { game: string; play: string; market?: string }): string {
  const game = normalizeGame(p.game);
  const play = norm(p.play);
  const market = (p.market || "").toLowerCase();

  let side: string;
  if (market === "total" || /\bover\b/.test(play)) {
    side = "total:over";
  } else if (/\bunder\b/.test(play)) {
    side = "total:under";
  } else if (/\bdraw\b/.test(play)) {
    side = "ml:draw";
  } else if (market === "ml" || /\bml\b/.test(play)) {
    side = "ml:" + play.replace(/\bml\b/g, "").trim();
  } else if (market === "prop") {
    side = "prop:" + play;
  } else {
    // Spread (default): the team before the +/-number, e.g. "Nevada -9.5" -> "nevada".
    const m = play.match(/^(.+?)\s*[+-]\d/);
    side = "spread:" + (m ? m[1].trim() : play);
  }
  return `${game}|${side}`;
}
