/**
 * Transforms raw Odds API events + opening snapshots into the board view model:
 * per-game, per-book, per-market cells with opening vs current, deltas,
 * steam flags, and best-price highlighting.
 */
import {
  OddsEvent,
  computeDelta,
  bestPriceBook,
  fmtAmerican,
  BOOK_LABELS,
  SPORT_LABELS,
} from "./odds-shared";

export interface CellVM {
  display: string; // "-3.5 (-110)"
  openDisplay: string; // "-2 (-105)" or "—"
  pointDelta?: number;
  priceDelta?: number;
  moved: boolean;
  steam: boolean;
  best: boolean;
}

export interface BookVM {
  key: string;
  label: string;
  spreadAway: CellVM | null;
  spreadHome: CellVM | null;
  totalOver: CellVM | null;
  totalUnder: CellVM | null;
  mlAway: CellVM | null;
  mlHome: CellVM | null;
}

export interface GameVM {
  id: string;
  sport: string;
  sportLabel: string;
  commence: string;
  away: string;
  home: string;
  books: BookVM[];
  steamCount: number;
  edgeScore: number; // max line-move magnitude across all cells — drives top-edges sort
}

export interface MoverVM {
  game: string;
  sport: string;
  label: string; // "Chiefs -3 → -4.5"
  detail: string; // "DraftKings spread"
  steam: boolean;
  magnitude: number;
}

const BOOK_ORDER = ["draftkings", "fanduel", "betmgm", "caesars"];

function cellDisplay(point: number | undefined, price: number): string {
  const p = point !== undefined ? `${point > 0 ? "+" : ""}${point} ` : "";
  return `${p}(${fmtAmerican(price)})`;
}

function makeCell(
  open: { price: number; point?: number } | undefined,
  cur: { price: number; point?: number },
  isBest: boolean
): CellVM {
  const d = computeDelta(open, cur);
  return {
    display: cellDisplay(cur.point, cur.price),
    openDisplay: open ? cellDisplay(open.point, open.price) : "—",
    pointDelta: d.pointDelta,
    priceDelta: d.priceDelta,
    moved: d.moved,
    steam: d.steam,
    best: isBest,
  };
}

export function buildBoard(
  events: OddsEvent[],
  openings: Record<string, Record<string, Record<string, Record<string, { price: number; point?: number }>>>>
): { games: GameVM[]; movers: MoverVM[]; sports: string[] } {
  const games: GameVM[] = [];
  const movers: MoverVM[] = [];
  const sportSet = new Set<string>();

  for (const ev of events) {
    sportSet.add(ev.sport_key);
    const open = openings[ev.id] || {};

    // First pass: gather raw outcomes per book into a clean intermediate shape
    interface RawCell {
      cur: { price: number; point?: number };
      open?: { price: number; point?: number };
      name: string;
    }
    interface RawBook {
      key: string;
      label: string;
      cells: Record<"spreadAway" | "spreadHome" | "totalOver" | "totalUnder" | "mlAway" | "mlHome", RawCell | null>;
    }
    const rawBooks: RawBook[] = [];
    const COLS = ["spreadAway", "spreadHome", "totalOver", "totalUnder", "mlAway", "mlHome"] as const;
    type Col = (typeof COLS)[number];

    for (const bookKey of BOOK_ORDER) {
      const bm = ev.bookmakers.find((b) => b.key === bookKey);
      if (!bm) continue;
      const get = (marketKey: string, outcome: string) => {
        const m = bm.markets.find((x) => x.key === marketKey);
        return m?.outcomes.find((o) => o.name === outcome);
      };
      const openGet = (marketKey: string, outcome: string) => open[bookKey]?.[marketKey]?.[outcome];
      const cell = (marketKey: string, outcome: string): RawCell | null => {
        const cur = get(marketKey, outcome);
        if (!cur) return null;
        return { cur: { price: cur.price, point: cur.point }, open: openGet(marketKey, outcome), name: outcome };
      };
      rawBooks.push({
        key: bookKey,
        label: BOOK_LABELS[bookKey] || bookKey,
        cells: {
          spreadAway: cell("spreads", ev.away_team),
          spreadHome: cell("spreads", ev.home_team),
          totalOver: cell("totals", "Over"),
          totalUnder: cell("totals", "Under"),
          mlAway: cell("h2h", ev.away_team),
          mlHome: cell("h2h", ev.home_team),
        },
      });
    }

    // Best-price per column across books present
    const bestByCol: Record<Col, string | null> = {} as Record<Col, string | null>;
    for (const col of COLS) {
      const cands = rawBooks
        .map((b) => (b.cells[col] ? { key: b.key, price: b.cells[col]!.cur.price } : null))
        .filter((x): x is { key: string; price: number } => x !== null);
      bestByCol[col] = bestPriceBook(cands);
    }

    // Second pass: finalize cells with best flags + collect movers
    const books: BookVM[] = [];
    let steamCount = 0;
    let edgeScore = 0;
    for (const rb of rawBooks) {
      const finalCells = {} as Record<Col, CellVM | null>;
      for (const col of COLS) {
        const raw = rb.cells[col];
        if (!raw) {
          finalCells[col] = null;
          continue;
        }
        const c = makeCell(raw.open, raw.cur, bestByCol[col] === rb.key);
        finalCells[col] = c;
        const mag = Math.abs(c.pointDelta ?? 0) * 10 + Math.abs(c.priceDelta ?? 0) / 10;
        if (c.moved) edgeScore = Math.max(edgeScore, mag);
        if (c.steam) {
          steamCount++;
          movers.push({
            game: `${ev.away_team} @ ${ev.home_team}`,
            sport: SPORT_LABELS[ev.sport_key] || ev.sport_key,
            label: `${raw.name} ${c.openDisplay} → ${c.display}`,
            detail: `${rb.label} · ${colLabel(col)}`,
            steam: true,
            magnitude: mag,
          });
        } else if (c.moved && Math.abs(c.pointDelta ?? 0) >= 1) {
          movers.push({
            game: `${ev.away_team} @ ${ev.home_team}`,
            sport: SPORT_LABELS[ev.sport_key] || ev.sport_key,
            label: `${raw.name} ${c.openDisplay} → ${c.display}`,
            detail: `${rb.label} · ${colLabel(col)}`,
            steam: false,
            magnitude: mag,
          });
        }
      }
      books.push({
        key: rb.key,
        label: rb.label,
        spreadAway: finalCells.spreadAway,
        spreadHome: finalCells.spreadHome,
        totalOver: finalCells.totalOver,
        totalUnder: finalCells.totalUnder,
        mlAway: finalCells.mlAway,
        mlHome: finalCells.mlHome,
      });
    }

    games.push({
      id: ev.id,
      sport: ev.sport_key,
      sportLabel: SPORT_LABELS[ev.sport_key] || ev.sport_title,
      commence: ev.commence_time,
      away: ev.away_team,
      home: ev.home_team,
      books,
      steamCount,
      edgeScore,
    });
  }

  // Sort games: biggest edge (max line-move magnitude) first, then steam, then start time
  games.sort(
    (a, b) =>
      b.edgeScore - a.edgeScore ||
      b.steamCount - a.steamCount ||
      +new Date(a.commence) - +new Date(b.commence)
  );
  movers.sort((a, b) => b.magnitude - a.magnitude);

  return { games, movers: movers.slice(0, 10), sports: [...sportSet] };
}

function colLabel(col: string): string {
  switch (col) {
    case "spreadAway":
    case "spreadHome":
      return "spread";
    case "totalOver":
    case "totalUnder":
      return "total";
    default:
      return "moneyline";
  }
}
