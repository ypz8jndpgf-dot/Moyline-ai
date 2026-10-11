import { Redis } from "@upstash/redis";
import { mergeKey } from "./card-utils";

/** Virtual bankroll start and flat stake per paper bet. */
export const PAPER_START = 1000;
export const PAPER_STAKE = 10;

export type PaperStatus = "open" | "win" | "loss" | "push";

export type PaperSource = "card" | "backpage";

export interface PaperBet {
  id: string;
  date: string; // card date (YYYY-MM-DD)
  game: string;
  play: string;
  price: string; // as listed, e.g. "-110"
  odds: number; // parsed american odds
  stake: number;
  status: PaperStatus;
  pnl: number | null; // settled profit/loss, null while open
  placed_at: string;
  settled_at?: string;
  source: PaperSource; // "card" = main card, "backpage" = admin-only backpage tab
}

function redis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

const BANKROLL_KEY = "moyline:paper:bankroll";
const BETS_KEY = "moyline:paper:bets";

/** Profit on a winning stake at american odds. */
export function profitFor(odds: number, stake: number): number {
  if (odds > 0) return (stake * odds) / 100;
  return (stake * 100) / Math.abs(odds);
}

/** Extract american odds from a price string like "-110 (FanDuel)" or "+470". */
export function parseOdds(price: string): number | null {
  const m = (price || "").match(/([+-]?\d{2,})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return isNaN(n) ? null : n;
}

export async function getBankroll(): Promise<number> {
  const v = await redis().get<number>(BANKROLL_KEY);
  if (v == null) {
    await redis().set(BANKROLL_KEY, PAPER_START);
    return PAPER_START;
  }
  return Number(v);
}

export async function getBets(): Promise<PaperBet[]> {
  const bets = await redis().get<PaperBet[]>(BETS_KEY);
  return bets || [];
}

async function saveBets(bets: PaperBet[]): Promise<void> {
  await redis().set(BETS_KEY, bets);
}

/** Place paper bets for newly added card picks. Skips picks without parseable odds.
 *
 * Atomic via a single Lua script: appending the bets and reserving their stakes
 * from the bankroll happen together or not at all. This closes the 2026-10-11 7am
 * race, where a partial failure between the bets write and the bankroll
 * reservation left the bets OPEN with no stake reserved while the route reported
 * paper_bets_placed:0. Dedupe against existing bets happens inside the script, so
 * concurrent pushes can no longer double-place the same pick either.
 * Returns the bets that were actually added. */
export async function placePaperBets(
  picks: { game: string; play: string; price: string }[],
  date: string,
  source: PaperSource = "card"
): Promise<PaperBet[]> {
  const r = redis();
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const candidates: PaperBet[] = [];
  for (const p of picks) {
    const key = mergeKey({ game: p.game, play: p.play });
    if (seen.has(key)) continue;
    seen.add(key);
    const odds = parseOdds(p.price || "");
    if (odds == null) continue;
    candidates.push({
      id: `${date}-${source}-${key}`.slice(0, 120),
      date,
      game: p.game,
      play: p.play,
      price: p.price,
      odds,
      stake: PAPER_STAKE,
      status: "open",
      pnl: null,
      placed_at: now,
      source,
    });
  }
  if (candidates.length === 0) return [];

  const script = `
    local raw = redis.call("GET", KEYS[1])
    local bets = {}
    if raw then bets = cjson.decode(raw) end
    local have = {}
    for _, b in ipairs(bets) do have[b.id] = true end
    local added = {}
    for _, c in ipairs(cjson.decode(ARGV[1])) do
      if not have[c.id] then
        bets[#bets + 1] = c
        added[#added + 1] = c
        have[c.id] = true
      end
    end
    if #added > 0 then
      redis.call("SET", KEYS[1], cjson.encode(bets))
      -- INCRBYFLOAT, not INCRBY: the bankroll routinely carries cents after
      -- settlements (e.g. 994.05), and INCRBY errors on non-integer values.
      redis.call("INCRBYFLOAT", KEYS[2], 0 - (tonumber(ARGV[2]) * #added))
    end
    return cjson.encode(added)
  `;
  const out = (await r.eval(script, [BETS_KEY, BANKROLL_KEY], [
    JSON.stringify(candidates),
    String(PAPER_STAKE),
  ])) as string;
  try {
    const placed = JSON.parse(out) as PaperBet[];
    return Array.isArray(placed) ? placed : [];
  } catch {
    return [];
  }
}

/**
 * Settle open paper bets against graded results.
 * grades: [{ game, play, result: "win" | "loss" | "push" }]
 * Returns the settled bets.
 */
export async function settlePaperBets(
  grades: { game: string; play: string; result: PaperStatus }[]
): Promise<PaperBet[]> {
  const r = redis();
  const bets = (await r.get<PaperBet[]>(BETS_KEY)) || [];
  const gradeByKey = new Map(
    grades.map((g) => [mergeKey({ game: g.game, play: g.play }), g.result])
  );
  const now = new Date().toISOString();
  let bankrollDelta = 0;
  const settled: PaperBet[] = [];
  for (const b of bets) {
    if (b.status !== "open") continue;
    const result = gradeByKey.get(mergeKey({ game: b.game, play: b.play }));
    if (!result || result === "open") continue;
    b.status = result;
    b.settled_at = now;
    if (result === "win") {
      b.pnl = Math.round(profitFor(b.odds, b.stake) * 100) / 100;
      bankrollDelta += b.stake + b.pnl; // stake back + profit
    } else if (result === "loss") {
      b.pnl = -b.stake; // stake was already reserved
    } else {
      b.pnl = 0;
      bankrollDelta += b.stake; // stake back
    }
    settled.push(b);
  }
  if (settled.length > 0) {
    await r.set(BETS_KEY, bets);
    if (bankrollDelta !== 0) await r.incrbyfloat(BANKROLL_KEY, bankrollDelta);
  }
  return settled;
}
