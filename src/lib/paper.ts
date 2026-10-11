import { Redis } from "@upstash/redis";
import { mergeKey } from "./card-utils";

/** Virtual bankroll start and flat stake per paper bet. */
export const PAPER_START = 1000;
export const PAPER_STAKE = 10;

export type PaperStatus = "open" | "win" | "loss" | "push";

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

/** Place paper bets for newly added card picks. Skips picks without parseable odds. */
export async function placePaperBets(
  picks: { game: string; play: string; price: string }[],
  date: string
): Promise<PaperBet[]> {
  const r = redis();
  const existing = (await r.get<PaperBet[]>(BETS_KEY)) || [];
  const existingKeys = new Set(
    existing.map((b) => mergeKey({ game: b.game, play: b.play }))
  );
  const now = new Date().toISOString();
  const fresh: PaperBet[] = [];
  for (const p of picks) {
    const key = mergeKey({ game: p.game, play: p.play });
    if (existingKeys.has(key)) continue;
    const odds = parseOdds(p.price || "");
    if (odds == null) continue;
    existingKeys.add(key);
    fresh.push({
      id: `${date}-${key}`.slice(0, 120),
      date,
      game: p.game,
      play: p.play,
      price: p.price,
      odds,
      stake: PAPER_STAKE,
      status: "open",
      pnl: null,
      placed_at: now,
    });
  }
  if (fresh.length > 0) {
    await r.set(BETS_KEY, [...existing, ...fresh]);
    // Reserve stakes from the bankroll up front.
    await r.incrby(BANKROLL_KEY, -PAPER_STAKE * fresh.length);
  }
  return fresh;
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
