import { Redis } from "@upstash/redis";
import { getPicksFeed, type FeedPick } from "@/lib/picks";
import { buildBoard } from "@/lib/board";
import { findBoardGame, mergeKey } from "@/lib/card-utils";
import { BOOK_LABELS, type OddsEvent } from "@/lib/odds-shared";

/**
 * CLV (closing line value) capture — closing-proxy lines for today's card.
 *
 * WHY: the graded record's steam split ("did the line move toward our pick
 * after publication?") was not computable for the full record — no closing
 * lines were stored anywhere, and the odds snapshot is overwritten at every
 * refresh (see ~/workspace/sports-betting/algo-splits-2026-10-23.md §3).
 * This capture fixes that going forward with ZERO extra Odds API calls: it
 * runs inside the existing /api/refresh run (12:00 + 22:00 UTC) and records,
 * from the snapshot that run just fetched, the current board line for every
 * ungraded pick on today's card whose game has not started.
 *
 * STORAGE: one Redis hash per ET game day — moyline:clv:<YYYY-MM-DD>
 *   field: mergeKey(pick) — normalized game|market:side identity, the same
 *          key the picks-feed merge uses (src/lib/card-utils.ts).
 *   value: JSON { line, price, book, updatedAt, gameStart }
 *            line      -> spread/total point (number), null for moneylines
 *            price     -> American odds (number) at capture time
 *            book      -> book label the line came from (see book choice)
 *            updatedAt -> ISO timestamp of this capture
 *            gameStart -> ISO commence time of the game
 *   TTL: ~10 days (refreshed on every write).
 *
 * Every refresh OVERWRITES each still-upcoming pick's field, so the last
 * write before the game's start is the closing proxy by construction.
 * Picks whose game has already started are SKIPPED — a stored pre-game
 * value is never overwritten with in-game lines.
 *
 * BOOK CHOICE: the book named in the pick's published price (e.g.
 * "-110 (DraftKings)") when that book carries the market on the board;
 * otherwise DraftKings (the site's reference book), then the remaining
 * board books in board order. The book actually used is stored in the
 * value, so the grader always knows what it is comparing against.
 *
 * MATCHING: a pick is captured only when it matches a board game via
 * findBoardGame (both teams) AND its market/side resolves to a concrete
 * board outcome. Anything ambiguous is skipped — never guessed. Known
 * gaps (per the splits report): prop markets are not in the board
 * snapshot at all, so props are never captured; teaser/parlay legs are
 * unstructured strings with no game/market identity, so they are not
 * captured either. Lookahead spotlight picks are structured and ARE
 * captured, filed under their game's ET day.
 *
 * SAFETY: fully best-effort. The refresh route fires this without
 * awaiting it, and every failure path is caught — a CLV failure can
 * never fail or delay a refresh.
 */

const KEY_PREFIX = "moyline:clv:";
const TTL_SECONDS = 60 * 60 * 24 * 10; // ~10 days
const BOOK_ORDER = ["draftkings", "fanduel", "betmgm", "caesars"];

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) {
    s = s.slice(eq + 1).trim();
  }
  return s.replace(/^["']+|["']+$/g, "");
}

function getRedis(): Redis | null {
  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** True if every word of `short` appears in `full` (mirrors card-utils). */
function teamMatches(short: string, full: string): boolean {
  const sWords = norm(short).split(" ").filter(Boolean);
  const fWords = new Set(norm(full).split(" ").filter(Boolean));
  if (sWords.length === 0) return false;
  return sWords.every((w) => fWords.has(w));
}

type PickLike = {
  game: string;
  play: string;
  price: string;
  market?: string;
};

type ResolvedOutcome = {
  marketKey: "spreads" | "totals" | "h2h";
  outcomeName: string;
};

/** Which board team does this play text name? Null when neither or both. */
function matchTeam(
  text: string,
  ev: OddsEvent,
  marketKey: ResolvedOutcome["marketKey"]
): ResolvedOutcome | null {
  const away = teamMatches(text, ev.away_team);
  const home = teamMatches(text, ev.home_team);
  if (away && !home) return { marketKey, outcomeName: ev.away_team };
  if (home && !away) return { marketKey, outcomeName: ev.home_team };
  return null;
}

/**
 * Resolve a feed pick to a concrete board outcome — or null (skip).
 * Precedence mirrors card-utils' bestPriceForPick, tightened so player
 * props can never be mistaken for game markets: a total is only taken
 * when the market says so or the play LEADS with Over/Under (game-total
 * plays do; prop plays lead with a player name and fall through to the
 * spread branch, where the team match fails and the pick is skipped).
 */
function resolveOutcome(pick: PickLike, ev: OddsEvent): ResolvedOutcome | null {
  const rawPlay = pick.play || "";
  const play = norm(rawPlay);
  const market = (pick.market || "").toLowerCase();

  if (market === "prop") return null; // board snapshot carries no prop markets

  if (market === "total" || /^\s*(over|under)\b/i.test(rawPlay)) {
    if (/\bunder\b/.test(play)) return { marketKey: "totals", outcomeName: "Under" };
    if (/\bover\b/.test(play)) return { marketKey: "totals", outcomeName: "Over" };
    return null; // total with no readable side — never guess
  }
  if (/\bdraw\b/.test(play)) return { marketKey: "h2h", outcomeName: "Draw" };
  if (market === "ml" || /\bml\b/.test(play)) {
    return matchTeam(play.replace(/\bml\b/g, "").trim(), ev, "h2h");
  }
  // Spread (default): the team before the +/-number, e.g. "Nevada -9.5".
  const m = rawPlay.match(/^(.+?)\s*[+-]\d/);
  return matchTeam(m ? m[1] : rawPlay, ev, "spreads");
}

/** Book key named in a published price like "-110 (DraftKings)", if any. */
function preferredBookKey(price: string | undefined): string | null {
  const m = (price || "").match(/\(([^)]+)\)/);
  if (!m) return null;
  const label = m[1].trim().toLowerCase();
  for (const [key, lbl] of Object.entries(BOOK_LABELS)) {
    if (lbl.toLowerCase() === label) return key;
  }
  return null;
}

function boardOutcome(
  ev: OddsEvent,
  res: ResolvedOutcome,
  preferred: string | null
): { price: number; point?: number; bookKey: string } | null {
  const order: string[] = [];
  for (const k of [preferred, "draftkings", ...BOOK_ORDER]) {
    if (k && !order.includes(k)) order.push(k);
  }
  for (const key of order) {
    const bm = ev.bookmakers.find((b) => b.key === key);
    const mkt = bm?.markets.find((x) => x.key === res.marketKey);
    const oc = mkt?.outcomes.find((o) => o.name === res.outcomeName);
    if (oc) return { price: oc.price, point: oc.point, bookKey: key };
  }
  return null;
}

export type ClvEntry = {
  line: number | null;
  price: number;
  book: string;
  updatedAt: string;
  gameStart: string;
};

/**
 * Upsert the current board line for every ungraded, not-yet-started pick
 * on today's card. Called fire-and-forget from /api/refresh with the
 * events that run just fetched. Returns how many picks were captured.
 */
export async function captureClvLines(events: OddsEvent[]): Promise<number> {
  try {
    const redis = getRedis();
    if (!redis || !events || events.length === 0) return 0;

    const feed = await getPicksFeed();
    if (!feed) return 0;

    const candidates: PickLike[] = [
      ...feed.picks,
      ...(feed.props || []),
      ...(feed.lookaheads?.spotlight?.picks || []),
    ];
    if (candidates.length === 0) return 0;

    const { games } = buildBoard(events, {});
    const rawById = new Map(events.map((e) => [e.id, e]));
    const now = Date.now();
    const byDay = new Map<string, Record<string, string>>();
    let captured = 0;

    for (const pick of candidates) {
      if ((pick.market || "").toLowerCase() === "prop") continue;
      const bg = findBoardGame(pick as FeedPick, games);
      if (!bg) continue;
      // Started games are skipped: the stored pre-game value IS the
      // closing proxy and must never be overwritten by live lines.
      if (new Date(bg.commence).getTime() <= now) continue;
      const ev = rawById.get(bg.id);
      if (!ev) continue;
      const res = resolveOutcome(pick, ev);
      if (!res) continue;
      const oc = boardOutcome(ev, res, preferredBookKey(pick.price));
      if (!oc) continue;

      const day = new Date(bg.commence).toLocaleDateString("en-CA", {
        timeZone: "America/New_York",
      });
      const entry: ClvEntry = {
        line: oc.point ?? null,
        price: oc.price,
        book: BOOK_LABELS[oc.bookKey] || oc.bookKey,
        updatedAt: new Date().toISOString(),
        gameStart: bg.commence,
      };
      const fields = byDay.get(day) || {};
      fields[mergeKey(pick)] = JSON.stringify(entry);
      byDay.set(day, fields);
      captured++;
    }

    for (const [day, fields] of byDay) {
      const key = KEY_PREFIX + day;
      const pipe = redis.pipeline();
      pipe.hset(key, fields);
      pipe.expire(key, TTL_SECONDS);
      await pipe.exec();
    }

    if (captured > 0) {
      console.log(`[clv] captured closing-proxy lines for ${captured} pick(s)`);
    }
    return captured;
  } catch (e) {
    console.error("[clv] capture failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Read one ET day's captured closing proxies (field -> entry). */
export async function getClvForDate(date: string): Promise<Record<string, ClvEntry>> {
  const redis = getRedis();
  if (!redis) return {};
  try {
    const raw = await redis.hgetall<Record<string, unknown>>(KEY_PREFIX + date);
    if (!raw) return {};
    const out: Record<string, ClvEntry> = {};
    for (const [field, v] of Object.entries(raw)) {
      try {
        const entry = (typeof v === "string" ? JSON.parse(v) : v) as ClvEntry;
        if (entry && typeof entry.price === "number" && typeof entry.book === "string") {
          out[field] = entry;
        }
      } catch {
        // Skip malformed entries.
      }
    }
    return out;
  } catch {
    return {};
  }
}
