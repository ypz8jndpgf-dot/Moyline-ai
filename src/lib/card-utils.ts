import { GameVM, MoverVM } from "./board";
import { FeedPick } from "./picks";

/** "Nevada @ UTEP (CFB)" -> { away: "Nevada", home: "UTEP" }. */
export function parseGameTeams(game: string): { away: string; home: string } | null {
  const m = game.match(/^\s*(.+?)\s+@\s+(.+?)\s*(\(|$)/);
  if (!m) return null;
  return { away: m[1].trim(), home: m[2].trim() };
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
