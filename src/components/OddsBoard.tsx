"use client";

import { useMemo, useState } from "react";
import type { GameVM, MoverVM, CellVM, BookVM } from "@/lib/board";
import type { BoardPropGameVM, BoardPropRowVM } from "@/lib/cheatsheet";
import { SPORT_LABELS } from "@/lib/odds-shared";
import LineAlertButton from "./LineAlertButton";

function DeltaBadge({ cell }: { cell: CellVM }) {
  if (!cell.moved) return null;
  const parts: string[] = [];
  if (cell.pointDelta !== undefined && cell.pointDelta !== 0) {
    const arrow = cell.pointDelta > 0 ? "▲" : "▼";
    const color = cell.pointDelta > 0 ? "text-up" : "text-down";
    parts.push(`${arrow}`);
    return (
      <span className={`ml-1 text-[11px] font-bold ${color}`}>
        {arrow} {Math.abs(cell.pointDelta)}
      </span>
    );
  }
  if (cell.priceDelta !== undefined && cell.priceDelta !== 0) {
    const arrow = cell.priceDelta > 0 ? "▲" : "▼";
    const color = cell.priceDelta > 0 ? "text-up" : "text-down";
    return (
      <span className={`ml-1 text-[11px] font-bold ${color}`}>
        {arrow} {Math.abs(cell.priceDelta)}¢
      </span>
    );
  }
  return null;
}

function SideCell({ cell }: { cell: CellVM | null }) {
  if (!cell) return <div className="py-1.5 text-muted/40 text-[11px]">—</div>;
  return (
    <div
      className={`py-1.5 px-1 text-[12px] whitespace-nowrap rounded ${
        cell.steam ? "steam-flash" : ""
      } ${cell.best ? "best-price" : ""}`}
    >
      {cell.display}
      <DeltaBadge cell={cell} />
    </div>
  );
}

/** The benchmark for a market row: the first-tracked line, from DraftKings
 *  when it posted one, otherwise the first book that did. */
function openForRow(game: GameVM, get: (b: BookVM) => CellVM | null): string {
  const ordered = [...game.books].sort((a, b) =>
    a.key === "draftkings" ? -1 : b.key === "draftkings" ? 1 : 0
  );
  for (const b of ordered) {
    const c = get(b);
    if (c && c.openDisplay && c.openDisplay !== "—") return c.openDisplay;
  }
  return "—";
}

/** Best current moneyline price for one side, from the board's cells. */
function bestMoneylinePrice(game: GameVM, side: "away" | "home"): number | null {
  let best: number | null = null;
  for (const b of game.books) {
    const cell = side === "away" ? b.mlAway : b.mlHome;
    if (!cell) continue;
    const m = cell.display.match(/\(([+-]?\d+)\)/);
    if (!m) continue;
    const price = parseInt(m[1], 10);
    if (cell.best) return price;
    if (best === null || price > best) best = price;
  }
  return best;
}

const SHORT_BOOK: Record<string, string> = {
  DraftKings: "DK",
  FanDuel: "FD",
  BetMGM: "MGM",
  Caesars: "CZR",
};

const MARKET_ROWS: { label: string; tag: string; get: (b: BookVM) => CellVM | null }[] = [
  { label: "Spread", tag: "A", get: (b) => b.spreadAway },
  { label: "Spread", tag: "H", get: (b) => b.spreadHome },
  { label: "Total", tag: "O", get: (b) => b.totalOver },
  { label: "Total", tag: "U", get: (b) => b.totalUnder },
  { label: "ML", tag: "A", get: (b) => b.mlAway },
  { label: "ML", tag: "H", get: (b) => b.mlHome },
];

function GameCard({ game, onlyBook }: { game: GameVM; onlyBook?: string | null }) {
  // "Your book only" (optimization #81): narrow the price columns to the
  // member's book. A book that didn't price this game falls back to the
  // full column set rather than an empty table.
  const onlyCols = onlyBook ? game.books.filter((b) => b.label === onlyBook) : [];
  const cols = onlyCols.length > 0 ? onlyCols : game.books;
  const kickoff = new Date(game.commence);
  const timeStr = kickoff.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
  return (
    <div className="card card-glow p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="inline-block text-[10px] font-bold uppercase tracking-widest text-gold bg-gold/10 border border-gold/30 rounded px-2 py-0.5 mr-2">
            {game.sportLabel}
          </span>
          <span className="text-xs text-muted">{timeStr} ET</span>
          {game.steamCount > 0 && (
            <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-down">
              🔥 {game.steamCount} steam
            </span>
          )}
        </div>
        <LineAlertButton
          game={`${game.away} @ ${game.home}`}
          gameLabel={`${game.away} @ ${game.home}`}
          market="spread"
          side={game.away}
          currentLine={null}
        />
      </div>
      <h3 className="font-display text-lg mb-3">
        {game.away} <span className="text-muted">@</span> {game.home}
      </h3>
      {/* Books side by side: columns = books, rows = markets */}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-muted">
              <th className="text-left py-1 pr-2 w-14"></th>
              <th className="text-left py-1 pr-2 font-bold text-[11px] whitespace-nowrap">
                Open
              </th>
              {cols.map((b) => (
                <th
                  key={b.key}
                  className="text-left py-1 pr-2 font-bold text-goldsoft text-[11px] whitespace-nowrap"
                >
                  {SHORT_BOOK[b.label] || b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MARKET_ROWS.map((row, ri) => (
              <tr key={ri} className="border-t border-line/60">
                <td className="py-1 pr-2 text-[10px] uppercase tracking-widest text-muted whitespace-nowrap">
                  {row.label} <span className="text-paper font-bold">{row.tag}</span>
                </td>
                <td className="pr-2 py-1.5 text-[12px] whitespace-nowrap text-muted">
                  {openForRow(game, row.get)}
                </td>
                {cols.map((b) => (
                  <td key={b.key} className="pr-2">
                    <SideCell cell={row.get(b)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/60 pt-3">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
          Moneyline alerts
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs">
          {game.away}
          <LineAlertButton
            game={`${game.away} @ ${game.home}`}
            gameLabel={`${game.away} @ ${game.home}`}
            market="moneyline"
            side={game.away}
            currentLine={bestMoneylinePrice(game, "away")}
          />
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs">
          {game.home}
          <LineAlertButton
            game={`${game.away} @ ${game.home}`}
            gameLabel={`${game.away} @ ${game.home}`}
            market="moneyline"
            side={game.home}
            currentLine={bestMoneylinePrice(game, "home")}
          />
        </span>
      </div>
    </div>
  );
}

/** "Card games only" matching (optimization #65): feed game strings look
 *  like "Oklahoma City Thunder @ Portland Trail Blazers (NBA)"; the board
 *  carries full team names. Same tolerant name matching as the live-score
 *  strip — either name may be the longer form. */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function nameHit(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  return (
    na === nb ||
    na.endsWith(" " + nb) ||
    nb.endsWith(" " + na) ||
    (na.length >= 4 && nb.includes(na)) ||
    (nb.length >= 4 && na.includes(nb))
  );
}

function isCardGame(game: Pick<GameVM, "away" | "home">, cardGames: string[]): boolean {
  return cardGames.some((c) => {
    const parts = c.split("(")[0].split(/\s+@\s+|\s+vs\.?\s+/i);
    if (parts.length !== 2) return false;
    const [away, home] = [parts[0].trim(), parts[1].trim()];
    return (
      (nameHit(away, game.away) && nameHit(home, game.home)) ||
      (nameHit(away, game.home) && nameHit(home, game.away))
    );
  });
}

/* ------------------------- Props tab (#90) ------------------------- */

function fmtPropPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function fmtPropLine(line: number): string {
  return line % 1 === 0 ? String(Math.round(line)) : line.toFixed(1);
}

/** Up to five lines around the main line — enough to shop the ladder
 *  without turning the row into a spreadsheet. */
function propLineWindow(row: BoardPropRowVM) {
  const lines = row.lines;
  if (lines.length <= 5) return lines;
  const ml = row.mainLine;
  const mi = ml !== null ? lines.findIndex((l) => Math.abs(l.line - ml) < 1e-9) : -1;
  const center = mi >= 0 ? mi : Math.floor(lines.length / 2);
  const start = Math.max(0, Math.min(center - 2, lines.length - 5));
  return lines.slice(start, start + 5);
}

function PropRow({ row, onlyBook }: { row: BoardPropRowVM; onlyBook?: string | null }) {
  // "Your book only" (optimization #92): the prop cache carries only
  // the best price per line + side, so the filter keeps the sides
  // where the member's book hangs that best price. A row where their
  // book is best nowhere falls back to the full ladder rather than an
  // empty row — the #81 GameCard rule, one level down. Each chip
  // labels its book, so a fallback row never masquerades as the
  // member's own price.
  const atBook = onlyBook
    ? row.lines
        .map((l) => ({
          ...l,
          over: l.over && l.over.book === onlyBook ? l.over : null,
          under: l.under && l.under.book === onlyBook ? l.under : null,
        }))
        .filter((l) => l.over || l.under)
    : [];
  const lines = atBook.length > 0 ? atBook : row.lines;
  return (
    <div className="py-2 border-t border-line/60 first:border-t-0">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[13px]">
          <span className="font-bold">{row.player}</span>{" "}
          <span className="text-muted">{row.marketLabel}</span>
        </span>
        {row.mainLine !== null && (
          <span className="text-[11px] text-muted whitespace-nowrap">
            Main <span className="text-paper font-bold">{fmtPropLine(row.mainLine)}</span>
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {propLineWindow({ ...row, lines }).map((l) => (
          <span
            key={l.line}
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] whitespace-nowrap border ${
              l.main
                ? "border-gold/60 bg-gold/10 text-paper"
                : "border-line/60 bg-white/[0.03] text-muted"
            }`}
          >
            <span className={`font-bold ${l.main ? "text-goldsoft" : "text-paper"}`}>
              {fmtPropLine(l.line)}
            </span>
            {l.over && (
              <span>
                O {fmtPropPrice(l.over.price)}{" "}
                <span className="text-goldsoft font-bold">{SHORT_BOOK[l.over.book] || l.over.book}</span>
              </span>
            )}
            {l.under && (
              <span>
                U {fmtPropPrice(l.under.price)}{" "}
                <span className="text-goldsoft font-bold">{SHORT_BOOK[l.under.book] || l.under.book}</span>
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

const PROP_ROWS_PREVIEW = 10;

function PropGameCard({ game, onlyBook }: { game: BoardPropGameVM; onlyBook?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const matchup = game.game.replace(/\s*\([^)]+\)\s*$/, "");
  const rows = expanded ? game.rows : game.rows.slice(0, PROP_ROWS_PREVIEW);
  return (
    <div className="card card-glow p-4">
      <div className="flex items-center justify-between mb-1">
        <div>
          <span className="inline-block text-[10px] font-bold uppercase tracking-widest text-gold bg-gold/10 border border-gold/30 rounded px-2 py-0.5 mr-2">
            {game.sportLabel}
          </span>
          {game.starts && <span className="text-xs text-muted">{game.starts}</span>}
        </div>
        <span className="text-[11px] text-muted">{game.rows.length} props</span>
      </div>
      <h3 className="font-display text-lg mb-2">{matchup}</h3>
      <div>
        {rows.map((r) => (
          <PropRow key={`${r.player}|${r.market}`} row={r} onlyBook={onlyBook} />
        ))}
      </div>
      {game.rows.length > PROP_ROWS_PREVIEW && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-bold text-gold hover:text-goldsoft"
        >
          {expanded ? "Show fewer props" : `Show all ${game.rows.length} props`}
        </button>
      )}
    </div>
  );
}

/** Card-games matching for prop games: their labels are already the
 *  feed format ("Away @ Home (NBA)"), so the game board's name
 *  matching applies once the suffix is stripped. */
function isCardPropGame(game: BoardPropGameVM, cardGames: string[]): boolean {
  const matchup = game.game.replace(/\s*\([^)]+\)\s*$/, "");
  const parts = matchup.split(/\s+@\s+/);
  if (parts.length !== 2) return false;
  return isCardGame(
    { away: parts[0].trim(), home: parts[1].trim() },
    cardGames
  );
}

export default function OddsBoard({
  games,
  movers,
  sports,
  updatedAt,
  quotaNote,
  cardGames,
  propGames,
  primaryBook,
}: {
  games: GameVM[];
  movers: MoverVM[];
  sports: string[];
  updatedAt: string;
  quotaNote?: string;
  /** Today's card game strings from the picks feed (optimization #65). */
  cardGames?: string[];
  /** Today's live prop board from the board-props cache (optimization #90). */
  propGames?: BoardPropGameVM[];
  /** The signed-in member's primary book from prefs (optimization #81). */
  primaryBook?: string;
}) {
  const [tab, setTab] = useState<string>("all");
  const [view, setView] = useState<"games" | "props">("games");
  const [cardOnly, setCardOnly] = useState<boolean>(false);
  // "Your book only" (optimization #81): defaults to the member's primary
  // book from prefs; the picker covers members who never set one.
  const [bookOnly, setBookOnly] = useState<boolean>(false);
  const [bookPick, setBookPick] = useState<string>("");

  const boardBooks = useMemo(() => {
    const seen: string[] = [];
    for (const g of games) {
      for (const b of g.books) {
        if (!seen.includes(b.label)) seen.push(b.label);
      }
    }
    return seen;
  }, [games]);

  // Books appearing on the Props tab (optimization #92): the prop
  // cache's best-price attributions. Same four books as the game
  // board in practice; kept separate so the toggle + picker validate
  // against the view actually on screen.
  const propBooks = useMemo(() => {
    const seen: string[] = [];
    for (const g of propGames ?? []) {
      for (const r of g.rows) {
        for (const l of r.lines) {
          for (const s of [l.over, l.under]) {
            if (s && !seen.includes(s.book)) seen.push(s.book);
          }
        }
      }
    }
    return seen;
  }, [propGames]);

  const knownBooks = useMemo(() => {
    const seen = [...boardBooks];
    for (const b of propBooks) if (!seen.includes(b)) seen.push(b);
    return seen;
  }, [boardBooks, propBooks]);

  const viewBooks = view === "props" ? propBooks : boardBooks;

  const effBook =
    [bookPick, primaryBook || "", ...knownBooks].find(
      (b) => b && knownBooks.includes(b)
    ) || "";

  const cardCount = useMemo(
    () => (cardGames && cardGames.length > 0 ? games.filter((g) => isCardGame(g, cardGames)).length : 0),
    [games, cardGames]
  );

  const filtered = useMemo(() => {
    const byTab = tab === "all" ? games : games.filter((g) => g.sport === tab);
    return cardOnly && cardGames ? byTab.filter((g) => isCardGame(g, cardGames)) : byTab;
  }, [tab, games, cardOnly, cardGames]);

  const propCount = useMemo(
    () => (propGames ?? []).reduce((n, g) => n + g.rows.length, 0),
    [propGames]
  );

  const filteredProps = useMemo(() => {
    const all = propGames ?? [];
    const byTab = tab === "all" ? all : all.filter((g) => g.sportKey === tab);
    return cardOnly && cardGames
      ? byTab.filter((g) => isCardPropGame(g, cardGames))
      : byTab;
  }, [tab, propGames, cardOnly, cardGames]);

  const updated = updatedAt ? new Date(updatedAt).toLocaleString("en-US", { timeZone: "America/New_York" }) : "—";

  return (
    <div>
      {/* Lines freshness — surfaced on its own line, not buried in the legend */}
      <p className="text-xs text-muted mb-4">
        🕐 Lines updated <span className="text-paper font-semibold">{updated} ET</span>
        <span className="hidden sm:inline"> · refreshes every morning, plus Thu–Sun evenings</span>
      </p>

      {/* Biggest movers strip */}
      {movers.length > 0 && (
        <div className="mb-6">
          <h2 className="font-display text-sm uppercase tracking-widest text-gold mb-2">
            ⚡ Biggest movers
          </h2>
          <div className="card overflow-hidden">
            <div className="ticker py-2.5 px-4 text-[13px]">
              {[...movers, ...movers].map((m, i) => (
                <span key={i} className="inline-flex items-center gap-2">
                  <span className="text-muted text-[11px] uppercase">{m.sport}</span>
                  <span className="font-bold">{m.game}</span>
                  <span className={m.steam ? "text-down font-bold" : "text-goldsoft"}>{m.label}</span>
                  <span className="text-muted text-[11px]">{m.detail}</span>
                  <span className="text-gold mx-2">◆</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Games / Props view switch (optimization #90) */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setView("games")}
          aria-pressed={view === "games"}
          className={`px-4 py-1.5 rounded-full text-sm font-bold ${
            view === "games" ? "btn-gold" : "btn-ghost"
          }`}
        >
          Games
        </button>
        <button
          onClick={() => setView("props")}
          aria-pressed={view === "props"}
          className={`px-4 py-1.5 rounded-full text-sm font-bold ${
            view === "props" ? "btn-gold" : "btn-ghost"
          }`}
        >
          Player props{propCount > 0 ? ` (${propCount})` : ""}
        </button>
      </div>

      {/* League tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => setTab("all")}
          className={`px-4 py-1.5 rounded-full text-sm font-bold ${
            tab === "all" ? "btn-gold" : "btn-ghost"
          }`}
        >
          All
        </button>
        {sports.map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`px-4 py-1.5 rounded-full text-sm font-bold ${
              tab === s ? "btn-gold" : "btn-ghost"
            }`}
          >
            {SPORT_LABELS[s] || s}
          </button>
        ))}
        {cardCount > 0 && (
          <button
            onClick={() => setCardOnly((v) => !v)}
            aria-pressed={cardOnly}
            className={`px-4 py-1.5 rounded-full text-sm font-bold ${
              cardOnly ? "btn-gold" : "btn-ghost"
            }`}
          >
            🎯 Card games only ({cardCount})
          </button>
        )}
        {viewBooks.length > 1 && (
          <button
            onClick={() => setBookOnly((v) => !v)}
            aria-pressed={bookOnly}
            className={`px-4 py-1.5 rounded-full text-sm font-bold ${
              bookOnly ? "btn-gold" : "btn-ghost"
            }`}
          >
            📚 Your book only
          </button>
        )}
        {bookOnly && viewBooks.length > 1 && (
          <select
            value={effBook}
            onChange={(e) => setBookPick(e.target.value)}
            aria-label="Choose your book"
            className="px-3 py-1.5 rounded-full text-sm font-bold bg-white/5 border border-line text-paper focus:border-gold focus:outline-none"
          >
            {viewBooks.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
      </div>

      {view === "props" ? (
        <p className="text-xs text-muted mb-4">
          Best price across DraftKings, FanDuel, BetMGM and Caesars at each line · gold chip = the main line most books hang · lines from the live prop board — they post with the morning sheet and refresh through the day
          {bookOnly && effBook && (
            <span>
              {" "}· 📚 {effBook} only: showing the lines where your book hangs the best price — a player whose row your book doesn&apos;t lead keeps the full ladder
            </span>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted mb-4">
          Gold cell = best price, not a pick · Open = first tracked line (DraftKings when posted) — the benchmark every current line is judged against · ▲▼ = move since first tracked · 🔥 = steam move
          {quotaNote && <span className="text-down"> · {quotaNote}</span>}
        </p>
      )}

      {view === "props" ? (
        filteredProps.length === 0 ? (
          <div className="card p-8 text-center text-muted">
            <p className="mb-1">No prop lines on the board in this view.</p>
            <p className="text-sm">
              {(propGames ?? []).length === 0
                ? "Prop lines land here when the morning sheet pulls the live board — today's prop leans are on the Picks tab."
                : "Try another league tab, or turn off “Card games only.”"}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredProps.map((g) => (
              <PropGameCard key={g.game} game={g} onlyBook={bookOnly ? effBook : null} />
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-muted">
          {cardOnly ? (
            <>
              <p className="mb-1">No card games on the board in this view.</p>
              <p className="text-sm">Turn off “Card games only” or pick another league tab to see the full board.</p>
            </>
          ) : (
            <>
              <p className="mb-1">Lines are refreshing.</p>
              <p className="text-sm">The board updates throughout the day as books post numbers — check back soon.</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((g) => (
            <GameCard key={g.id} game={g} onlyBook={bookOnly ? effBook : null} />
          ))}
        </div>
      )}
    </div>
  );
}
