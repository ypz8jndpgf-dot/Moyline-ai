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
type CellKey = "spreadAway" | "spreadHome" | "totalOver" | "totalUnder" | "mlAway" | "mlHome";

/** Board cell holding this pick's market+side (shared by best/book price lookups). */
function cellKeyForPick(pick: FeedPick): CellKey | null {
  const teams = parseGameTeams(pick.game);
  const market = pick.market;
  const play = (pick.play || "").toLowerCase();

  if (market === "total" || /\bover\b|\bunder\b/.test(play)) {
    return /\bunder\b/.test(play) ? "totalUnder" : "totalOver";
  }
  if (market === "ml" || /\bml\b/.test(play)) {
    if (!teams) return null;
    // Which side is the ML team? Match the team name in the play text.
    const playNorm = norm(play.replace(/\bml\b/g, ""));
    const awayFirst = norm(teams.away).split(" ")[0];
    return playNorm.includes(awayFirst) ? "mlAway" : "mlHome";
  }
  // Spread (default): find the team in the play, e.g. "Nevada -9.5".
  if (!teams) return null;
  const playNorm = norm(play);
  const awayFirst = norm(teams.away).split(" ")[0];
  const homeFirst = norm(teams.home).split(" ")[0];
  if (playNorm.includes(awayFirst)) return "spreadAway";
  if (playNorm.includes(homeFirst)) return "spreadHome";
  return null;
}

export function bestPriceForPick(pick: FeedPick, game: GameVM): BestPrice {
  const cellKey = cellKeyForPick(pick);
  if (!cellKey) return null;

  let fallback: BestPrice = null;
  for (const b of game.books) {
    const cell = b[cellKey];
    if (!cell) continue;
    if (!fallback) fallback = { book: b.label, display: cell.display };
    if (cell.best) return { book: b.label, display: cell.display };
  }
  return fallback;
}

/** The price at one named book for this pick's market+side (steal #5 "my book"). */
export function bookPriceForPick(pick: FeedPick, game: GameVM, bookLabel: string): BestPrice {
  const cellKey = cellKeyForPick(pick);
  if (!cellKey) return null;
  const b = game.books.find(
    (x) => x.label.toLowerCase() === bookLabel.toLowerCase()
  );
  const cell = b?.[cellKey];
  return cell && b ? { book: b.label, display: cell.display } : null;
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

/**
 * Model win probability for a card pick (steal #4): the published edge in
 * cents is the gap between the market price and our fair price, so the
 * fair price is published − edge (−110 with a 25¢ edge → fair −135), and
 * the win probability is that fair price's implied probability. It's the
 * same number the edge already asserts, re-expressed — nothing new is
 * invented. Returns a whole percent, or null without a usable edge.
 */
export function modelWinProb(pick: FeedPick): number | null {
  const price = parseAmerican(pick.price);
  const edge = pick.edge_cents;
  if (price === null || edge == null || edge <= 0) return null;
  const fair = price - edge;
  if (fair === 0) return null;
  const prob =
    fair > 0 ? 100 / (fair + 100) : Math.abs(fair) / (Math.abs(fair) + 100);
  return Math.round(prob * 100);
}

/** First point value in a display string: "-3.5 (-110)" → -3.5, "(+108)" → null. */
function parsePoint(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/\([^)]*\)/g, " ").match(/([+-]?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function fmtAmerican(v: number): string {
  return v > 0 ? `+${v}` : `${v}`;
}

/**
 * "Line moved against you" note for a card pick (optimization #16,
 * 2026-10-27): when the best live board price for the pick's own side is
 * worse than what the card published, say so plainly instead of just
 * hiding the best-price badge. Movement uses the grader's CLV convention
 * (positive = toward the pick): spreads published − closing, totals
 * side-aware, moneylines by payout. Returns null when the live price is
 * at least as good, unparseable, or the pick is a prop (no board market).
 */
export function movedAgainstNote(pick: FeedPick, best: BestPrice): string | null {
  if (!best) return null;
  const market = pickAlertMarket(pick);
  if (!market) return null;
  const pubPrice = parseAmerican(pick.price);
  const nowPrice = parseAmerican(best.display);
  if (pubPrice === null || nowPrice === null) return null;

  if (market === "moneyline") {
    if (payout(nowPrice) >= payout(pubPrice)) return null;
    return `Line moved against this pick — published ${fmtAmerican(pubPrice)}, now ${fmtAmerican(nowPrice)} at ${best.book}`;
  }

  // Spread / total: compare points first, price breaks the tie.
  const pubPoint = parsePoint(pick.line) ?? parsePoint(pick.play);
  const nowPoint = parsePoint(best.display);
  if (pubPoint === null || nowPoint === null) return null;
  let movement: number;
  if (market === "spread") {
    movement = pubPoint - nowPoint;
  } else {
    const isOver = /\bover\b/i.test(pick.play || "");
    movement = isOver ? nowPoint - pubPoint : pubPoint - nowPoint;
  }
  const worse =
    movement < 0 || (movement === 0 && payout(nowPrice) < payout(pubPrice));
  if (!worse) return null;
  const pubDesc = `${pubPoint > 0 && market === "spread" ? "+" : ""}${pubPoint} (${fmtAmerican(pubPrice)})`;
  return `Line moved against this pick — published ${pubDesc}, now ${best.display} at ${best.book}`;
}

/**
 * One-line line journey for a card pick (optimization #20, 2026-10-28):
 * "Opened +3 (-110) · card +3.5 (-110) · now +3 (-110) at FanDuel".
 * Open comes from the tracked opening on the same board cell that
 * supplies the best price; the card beat is the published play itself.
 * Returns null when there's nothing to tell: no board cell, no tracked
 * opening AND the live line is identical to the published one, or the
 * pick is a prop (no board market). Beats that repeat the previous one
 * verbatim are collapsed so a static line reads "Opened X · now X".
 */
export function lineStoryForPick(pick: FeedPick, game: GameVM): string | null {
  const cellKey = cellKeyForPick(pick);
  if (!cellKey) return null;

  // Same cell selection as bestPriceForPick: best-flagged cell wins,
  // first available cell is the fallback.
  let chosen: { book: string; open: string; now: string } | null = null;
  for (const b of game.books) {
    const cell = b[cellKey];
    if (!cell) continue;
    if (!chosen) chosen = { book: b.label, open: cell.openDisplay, now: cell.display };
    if (cell.best) {
      chosen = { book: b.label, open: cell.openDisplay, now: cell.display };
      break;
    }
  }
  if (!chosen) return null;

  const pubPrice = parseAmerican(pick.price);
  if (pubPrice === null) return null;
  const market = pickAlertMarket(pick);
  if (!market) return null;
  const pubPoint = parsePoint(pick.line) ?? parsePoint(pick.play);
  const cardStr =
    market !== "moneyline" && pubPoint !== null
      ? `${pubPoint > 0 && market === "spread" ? "+" : ""}${pubPoint} (${fmtAmerican(pubPrice)})`
      : `(${fmtAmerican(pubPrice)})`;

  const hasOpen = chosen.open && chosen.open !== "—";
  if (!hasOpen && chosen.now === cardStr) return null;

  // The "now" beat always shows; the "card" beat is dropped only when
  // the tracked opening is identical to it (nothing happened pre-card).
  const beats: string[] = [];
  if (hasOpen) beats.push(`Opened ${chosen.open}`);
  if (!hasOpen || chosen.open !== cardStr) beats.push(`card ${cardStr}`);
  beats.push(`now ${chosen.now} at ${chosen.book}`);
  return beats.join(" · ");
}

/* ------------------------------------------------------------------ */
/* Steam selection — used by /api/refresh's alertCardSteam AND the      */
/* /picks page "Steam on your card" section. The old steamForGame fuzzy  */
/* matcher (any team-name word appearing anywhere in a mover's label,    */
/* substring-matched) was removed 2026-10-25 after it attached a Texas   */
/* Tech CFB spread move to Wild @ Canucks ("wild" ⊂ "Wildcats") and     */
/* listed both teams at every book on the picks page.                   */
/* ------------------------------------------------------------------ */

export interface CardSteamMove {
  game: string; // board label "Away @ Home"
  label: string; // display line for the alert email
  detail: string; // "<Book> · <market label>" of the representative mover
  /**
   * Collapsed dedupe identity: "v3|<game>|<market>|<side>" — one identity
   * per game+market+side across ALL books (v2 keyed per book and per side
   * row, so one spread move produced a bullet per book per team).
   * Totals use side "total" (Over/Under rows are one move).
   */
  id: string;
  /**
   * Every v2 dedupe id this collapsed line subsumes (per book, and for
   * totals per book). The refresh route treats an already-alerted v2 id as
   * seen, so a move alerted under the old scheme is not re-alerted under v3.
   */
  priorIds: string[];
  /** Labels of every raw mover collapsed into this line (legacy dedupe keys). */
  sourceLabels: string[];
}

type AlertMarket = "total" | "moneyline" | "spread";

/**
 * Market of a feed pick, mirroring bestPriceForPick's derivation.
 * Props return null — the board carries no prop markets, so a prop pick
 * can never have an actionable board move.
 */
function pickAlertMarket(pick: FeedPick): AlertMarket | null {
  const market = (pick.market || "").toLowerCase();
  if (market === "prop") return null;
  const play = (pick.play || "").toLowerCase();
  if (market === "total" || /\bover\b|\bunder\b/.test(play)) return "total";
  if (market === "ml" || /\bml\b/.test(play)) return "moneyline";
  return "spread";
}

/**
 * Market of a board mover, parsed from its detail string. board.ts builds
 * detail as "<Book label> · <colLabel(col)>" where colLabel maps
 * totalOver/totalUnder -> "total", spreadAway/spreadHome -> "spread",
 * mlAway/mlHome -> "moneyline". Fallback: totals are the only movers whose
 * outcome name (the label's leading word) is Over/Under.
 */
function moverMarket(m: MoverVM): AlertMarket | null {
  const seg = (m.detail.split("·").pop() || "").trim().toLowerCase();
  if (seg === "total") return "total";
  if (seg === "spread") return "spread";
  if (seg === "moneyline" || seg === "ml" || seg === "h2h") return "moneyline";
  if (/^(over|under)\b/i.test(m.label)) return "total";
  return null;
}

/** Book label of a mover: the segment before " · " in its detail string. */
function moverBook(m: MoverVM): string {
  return (m.detail.split("·")[0] || "").trim();
}

/**
 * Outcome (side) name at the head of a mover label. Labels look like
 * "Toronto Maple Leafs (-125)" or "Arizona State Sun Devils +2.5 (-110)"
 * before the arrow: strip the trailing "(price)" and the optional point.
 */
function moverOutcome(m: MoverVM): string {
  const head = m.label.split("→")[0].trim();
  return head
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+[+-]?\d+(?:\.\d+)?$/, "")
    .trim();
}

/**
 * Open/current point values from a mover label, without the spurious
 * leading "+" that cellDisplay puts on (always-positive) total points:
 * "Over +63.5 (-108) → +59.5 (-112)" -> { open: "63.5", cur: "59.5" }.
 */
function moverPoints(label: string): { open: string; cur: string } | null {
  const parts = label.split("→");
  if (parts.length !== 2) return null;
  const grab = (s: string): string | null => {
    const mm = s.match(/[+-]?\d+(?:\.\d+)?/);
    return mm ? mm[0].replace(/^\+/, "") : null;
  };
  const open = grab(parts[0]);
  const cur = grab(parts[1]);
  return open !== null && cur !== null ? { open, cur } : null;
}

/** Display label for a collapsed total move: "Total 63.5 → 59.5". */
function totalMoveLabel(rep: MoverVM): string {
  const pts = moverPoints(rep.label);
  if (pts) return `Total ${pts.open} → ${pts.cur}`;
  // Fallback: the raw label with the spurious "+" before point values removed.
  return rep.label.replace(/\+(?=\d)/g, "");
}

/** True when two team names refer to the same team (either may be the short form). */
function sameTeam(a: string, b: string): boolean {
  return teamMatches(a, b) || teamMatches(b, a);
}

/**
 * The board team name a spread/ML pick is ON, or null when it can't be
 * determined. Feed plays name the team in feed naming ("Bengals -1.5",
 * "Maple Leafs ML"); the side is matched against the feed game string,
 * then mapped to the board's full team name. A soccer "Draw ML" pick
 * resolves to "Draw". Null means: do not alert — an unverifiable side is
 * how the mirror-image team ends up in the email.
 */
function pickSideTeam(pick: FeedPick, bg: GameVM): string | null {
  const teams = parseGameTeams(pick.game);
  if (!teams) return null;
  const play = norm((pick.play || "").replace(/\bml\b/gi, " "));
  if (/\bdraw\b/.test(play)) return "Draw";
  const sideOf = (feedName: string): boolean =>
    teamMatches(feedName, play) ||
    play.split(" ").includes(norm(feedName).split(" ")[0]);
  if (sideOf(teams.away)) return sameTeam(teams.away, bg.away) ? bg.away : teams.away;
  if (sideOf(teams.home)) return sameTeam(teams.home, bg.home) ? bg.home : teams.home;
  return null;
}

/**
 * Representative-mover score: DraftKings is the site's reference book, so
 * its line represents a collapsed cross-book move; for totals the Over row
 * carries the canonical line.
 */
function repScore(m: MoverVM, isTotal: boolean): number {
  const book = moverBook(m).toLowerCase();
  let s = book === "draftkings" ? 2 : book === "fanduel" ? 1 : 0;
  if (isTotal && /^over\b/i.test(m.label)) s += 0.5;
  return s;
}

/**
 * Select the steam moves that are actually actionable for the main card.
 *
 * Replaces the alert path's old steamForGame matching, which (a) matched a
 * mover when ANY single team-name word appeared in its label — a pick on
 * "Arizona State" matched a San Diego State @ Colorado State mover via the
 * shared word "State", for a game that wasn't on the card at all — and
 * (b) fired on every market in a matched game, so a Maple Leafs ML pick
 * alerted on the TOR/EDM total move. Rules:
 *
 *  - A pick only sees movers from its OWN board game (via findBoardGame),
 *    and only movers whose `game` string is exactly that game's
 *    "Away @ Home" label.
 *  - A mover must be steam and its market must equal the pick's market.
 *  - For spread/ML, a mover must be on the pick's OWN side. A spread move
 *    exists on the board as two mirrored rows (each team's line flips
 *    sign); the other team's row is the same move, not a second one —
 *    v2 keyed by side without filtering to the pick's side, so the
 *    2026-10-25 Bengals alert listed both teams at three books (5 bullets
 *    for one move).
 *  - Movers collapse to ONE alert line per game+market+side across all
 *    books, represented by the DraftKings mover when available. The Over
 *    and Under rows of the same total are a single move (one line,
 *    "Total 63.5 → 59.5"). A move selected via two picks in the same
 *    game+market+side appears once.
 */
export function selectCardSteamMoves(
  picks: FeedPick[],
  games: GameVM[],
  movers: MoverVM[]
): CardSteamMove[] {
  interface Group {
    game: string;
    detail: string;
    id: string;
    isTotal: boolean;
    rep: MoverVM;
    repScore: number;
    priorIds: Set<string>;
    sourceLabels: string[];
  }
  const groups = new Map<string, Group>();

  for (const pick of picks) {
    const market = pickAlertMarket(pick);
    if (!market) continue;
    const bg = findBoardGame(pick, games);
    if (!bg) continue;
    const gameLabel = `${bg.away} @ ${bg.home}`;
    const isTotal = market === "total";
    // Totals have no side; spread/ML alert only on the pick's own side.
    const sideTeam = isTotal ? null : pickSideTeam(pick, bg);
    if (!isTotal && !sideTeam) continue;
    const sideKey = isTotal ? "total" : norm(sideTeam as string);

    for (const m of movers) {
      if (!m.steam || m.game !== gameLabel) continue;
      if (moverMarket(m) !== market) continue;
      if (!isTotal && !sameTeam(moverOutcome(m), sideTeam as string)) continue;
      const book = moverBook(m);
      const priorId = isTotal
        ? `v2|${gameLabel}|${book}|total`
        : `v2|${gameLabel}|${book}|${market}|${moverOutcome(m)}`;
      const id = `${gameLabel}|${market}|${sideKey}`;
      const g = groups.get(id);
      if (g) {
        g.sourceLabels.push(m.label);
        g.priorIds.add(priorId);
        const s = repScore(m, isTotal);
        if (s > g.repScore) {
          g.rep = m;
          g.repScore = s;
          g.detail = m.detail;
        }
      } else {
        groups.set(id, {
          game: gameLabel,
          detail: m.detail,
          id,
          isTotal,
          rep: m,
          repScore: repScore(m, isTotal),
          priorIds: new Set([priorId]),
          sourceLabels: [m.label],
        });
      }
    }
  }

  return [...groups.values()].map((g) => ({
    game: g.game,
    label: g.isTotal ? totalMoveLabel(g.rep) : g.rep.label,
    detail: g.detail,
    id: `v3|${g.id}`,
    priorIds: [...g.priorIds],
    sourceLabels: g.sourceLabels,
  }));
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
