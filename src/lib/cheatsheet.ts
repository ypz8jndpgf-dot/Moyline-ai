import { Redis } from "@upstash/redis";
import { getPicksFeed, sportFromGame, type FeedPick } from "@/lib/picks";
import type { PropLiveQuote } from "@/lib/card-utils";
import { getOddsCached, getQuotaState, QUOTA_CONSERVATIVE_PCT } from "@/lib/odds";
import { fmtAmerican, type OddsEvent } from "@/lib/odds-shared";

/**
 * Cheatsheet engine — Linemate-style guided prop sheet, MoyLine rules:
 * every hit rate is computed from REAL game logs (ESPN box scores), sample
 * sizes are always shown, and legs come only from today's researched prop
 * board (the brief feed). Nothing is projected or invented: a prop we can't
 * parse or can't find a game log for is counted as uncovered, never faked.
 *
 * Data flow: feed props → parse (player / direction / line / market) →
 * resolve player to an ESPN athlete + team → team schedule → per-game box
 * scores (Redis-cached; final games never change) → hit-rate splits.
 * Shared state lives in Redis only (never fs / module memory).
 */

const UA = { "User-Agent": "Mozilla/5.0 (compatible; MoyLineAI/1.0)" };
const HISTORY_GAMES = 12;

function cleanEnv(v: string | undefined): string {
  let s = (v || "").trim();
  const eq = s.indexOf("=");
  if (eq > 0 && /^[A-Z][A-Z0-9_]{2,}$/.test(s.slice(0, eq))) s = s.slice(eq + 1).trim();
  return s.replace(/^["']+|["']+$/g, "");
}

let redisClient: Redis | null | undefined;
function redis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const r = redis();
    if (!r) return null;
    const raw = await r.get<string>(key);
    if (!raw) return null;
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const r = redis();
    if (!r) return;
    await r.set(key, JSON.stringify(value), { ex: ttlSeconds });
  } catch {
    // Cache is best-effort — never break the sheet over it.
  }
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: UA, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Run async work over items with bounded concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/* ------------------------------ types ------------------------------ */

export type Split = { hits: number; n: number };

export type CheatRow = {
  date: string; // YYYY-MM-DD (ET)
  opp: string; // opponent abbreviation
  home: boolean;
  value: number;
  result: "hit" | "miss" | "push";
};

export type CheatLeg = {
  id: string;
  game: string;
  sport: string;
  starts?: string;
  play: string; // original feed play text
  price: string; // original feed price (incl. book)
  confidence: number; // feed confidence (2 or 3) — internal gate only, never displayed
  edge_cents?: number; // feed edge (brief legs only) — drives the win% + edge badge
  win_prob?: number; // feed model win prob (0-100), when the brief carries one
  source: "brief" | "board"; // brief = a researched MoyLine lean; board = live book prop (not a lean)
  player: string; // resolved full name
  team: string; // player's team abbreviation
  direction: "over" | "under";
  line: number;
  lineLabel: string; // e.g. "77.5" or "40+"
  market: string; // market key
  marketLabel: string; // e.g. "Rush + Rec Yards"
  splits: { l5: Split; l10: Split; all: Split; vsOpp: Split | null; venue: Split | null };
  streak: number; // consecutive hits, most recent first (push breaks it)
  avg10: number; // mean stat value over the fetched window (≤12 games)
  rows: CheatRow[]; // most recent first
};

export type CheatSheet = {
  date: string;
  legs: CheatLeg[];
  poolSize: number; // props on today's board
  covered: number; // props with real hit-rate data
};

/* --------------------------- prop parsing --------------------------- */

type MarketDef = { key: string; label: string; patterns: RegExp[] };

const MARKETS: MarketDef[] = [
  // Combos first — longest/most specific phrases win.
  { key: "rushRecYds", label: "Rush + Rec Yards", patterns: [/rush(?:ing)?\s*(?:\+|and)\s*rec(?:eiving)?\s*(?:yards|yds)/i, /scrimmage yards/i] },
  { key: "passRushYds", label: "Pass + Rush Yards", patterns: [/pass(?:ing)?\s*(?:\+|and)\s*rush(?:ing)?\s*(?:yards|yds)/i] },
  { key: "pra", label: "Pts + Reb + Ast", patterns: [/pts?\s*\+\s*reb\s*\+\s*ast/i, /\bpra\b/i, /points?\s*\+\s*rebounds?\s*\+\s*assists?/i] },
  { key: "ptsReb", label: "Pts + Reb", patterns: [/pts?\s*\+\s*reb/i, /points?\s*\+\s*rebounds?/i] },
  { key: "ptsAst", label: "Pts + Ast", patterns: [/pts?\s*\+\s*ast/i, /points?\s*\+\s*assists?/i] },
  { key: "rebAst", label: "Reb + Ast", patterns: [/reb\s*\+\s*ast/i, /rebounds?\s*\+\s*assists?/i] },
  { key: "stocks", label: "Steals + Blocks", patterns: [/steals?\s*\+\s*blocks?/i, /\bstocks\b/i] },
  // NFL
  { key: "passYds", label: "Pass Yards", patterns: [/pass(?:ing)?\s*(?:yards|yds)/i] },
  { key: "passTd", label: "Pass TDs", patterns: [/pass(?:ing)?\s*(?:tds?|touchdowns?)/i] },
  { key: "completions", label: "Completions", patterns: [/completions?/i] },
  { key: "passAtt", label: "Pass Attempts", patterns: [/pass(?:ing)?\s*attempts?/i] },
  { key: "passInt", label: "Interceptions Thrown", patterns: [/interceptions?(?:\s*thrown)?/i, /\bints?\b/i] },
  { key: "rushYds", label: "Rush Yards", patterns: [/rush(?:ing)?\s*(?:yards|yds)/i] },
  { key: "rushAtt", label: "Rush Attempts", patterns: [/rush(?:ing)?\s*attempts?/i, /carries/i] },
  { key: "recYds", label: "Receiving Yards", patterns: [/rec(?:eiving)?\s*(?:yards|yds)/i] },
  { key: "receptions", label: "Receptions", patterns: [/receptions?/i] },
  // NBA
  { key: "threes", label: "Three-Pointers Made", patterns: [/three[\s-]?pointers?(?:\s+made)?/i, /\bthrees\b/i, /\b3[\s-]?pointers?\b/i, /\b3pm\b/i] },
  { key: "points", label: "Points", patterns: [/points?/i, /\bpts\b/i] },
  { key: "rebounds", label: "Rebounds", patterns: [/rebounds?/i, /\breb\b/i] },
  { key: "assists", label: "Assists", patterns: [/assists?/i, /\bast\b/i] },
  { key: "steals", label: "Steals", patterns: [/steals?/i] },
  { key: "blocks", label: "Blocks", patterns: [/blocks?/i, /blocked shots?/i] },
  { key: "turnovers", label: "Turnovers", patterns: [/turnovers?/i] },
  // NHL
  { key: "shots", label: "Shots on Goal", patterns: [/shots?(?:\s+on\s+goal)?/i, /\bsog\b/i] },
  { key: "goals", label: "Goals", patterns: [/goals?/i] },
  { key: "saves", label: "Saves", patterns: [/saves?/i] },
];

export type ParsedProp = {
  playerQuery: string;
  direction: "over" | "under";
  line: number;
  lineLabel: string;
  market: string;
  marketLabel: string;
};

/** Parse a feed prop play ("Jacobs Over 77.5 rush+rec yards") into parts. */
export function parseProp(playRaw: string): ParsedProp | null {
  const play = playRaw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  let market: MarketDef | null = null;
  for (const m of MARKETS) {
    if (m.patterns.some((p) => p.test(play))) {
      market = m;
      break;
    }
  }

  // Anytime scorer markets carry no numeric line.
  if (/anytime/i.test(play) && /(td|touchdown)/i.test(play)) {
    const player = play.replace(/anytime.*$/i, "").trim();
    if (!player) return null;
    return { playerQuery: player, direction: "over", line: 0.5, lineLabel: "1+", market: "anytimeTd", marketLabel: "Anytime TD" };
  }
  if (/anytime/i.test(play) && /goal/i.test(play)) {
    const player = play.replace(/anytime.*$/i, "").trim();
    if (!player) return null;
    return { playerQuery: player, direction: "over", line: 0.5, lineLabel: "1+", market: "anytimeGoal", marketLabel: "Anytime Goal" };
  }
  if (!market) return null;

  // Threshold style: "Pollard 40+ rush yards" — cashes at 40 or more.
  const thresh = play.match(/(\d+(?:\.\d+)?)\s*\+/);
  const dirMatch = play.match(/\b(over|under)\s+(\d+(?:\.\d+)?)/i);
  let direction: "over" | "under";
  let line: number;
  let lineLabel: string;
  let nameEnd: number;
  if (dirMatch && dirMatch.index !== undefined) {
    direction = dirMatch[1].toLowerCase() as "over" | "under";
    line = parseFloat(dirMatch[2]);
    lineLabel = dirMatch[2];
    nameEnd = dirMatch.index;
  } else if (thresh && thresh.index !== undefined) {
    direction = "over";
    line = parseFloat(thresh[1]) - 0.5;
    lineLabel = `${thresh[1]}+`;
    nameEnd = thresh.index;
  } else {
    return null;
  }
  const player = play.slice(0, nameEnd).replace(/[-–—,]$/, "").trim();
  if (!player || player.length < 2) return null;
  return { playerQuery: player, direction, line, lineLabel, market: market.key, marketLabel: market.label };
}

/* ------------------------- stat computation ------------------------- */

/** Compute the market's stat value from a unified box-score stat map. */
export function statValue(sport: string, market: string, s: Record<string, number>): number | null {
  const g = (k: string) => (typeof s[k] === "number" ? s[k] : null);
  const sum = (...ks: string[]) => {
    let t = 0;
    for (const k of ks) {
      const v = g(k);
      if (v === null) return null;
      t += v;
    }
    return t;
  };
  switch (market) {
    case "passYds": return g("passYds");
    case "passTd": return g("passTd");
    case "completions": return g("passCmp");
    case "passAtt": return g("passAtt");
    case "passInt": return g("passInt");
    case "rushYds": return g("rushYds");
    case "rushAtt": return g("rushAtt");
    case "recYds": return g("recYds");
    case "receptions": return g("rec");
    case "rushRecYds": return sum("rushYds", "recYds");
    case "passRushYds": return sum("passYds", "rushYds");
    case "anytimeTd": return sum("rushTd", "recTd");
    case "anytimeGoal": return g("goals");
    case "points": return sport === "NHL" ? sum("goals", "assists") : g("points");
    case "rebounds": return g("rebounds");
    case "assists": return g("assists");
    case "threes": return g("threes");
    case "steals": return g("steals");
    case "blocks": return g("blocks");
    case "turnovers": return g("turnovers");
    case "pra": return sum("points", "rebounds", "assists");
    case "ptsReb": return sum("points", "rebounds");
    case "ptsAst": return sum("points", "assists");
    case "rebAst": return sum("rebounds", "assists");
    case "stocks": return sum("steals", "blocks");
    case "goals": return g("goals");
    case "shots": return g("shots");
    case "saves": return g("saves");
    default: return null;
  }
}

/* --------------------------- ESPN plumbing --------------------------- */

const SPORT_PATH: Record<string, string> = {
  NFL: "football/nfl",
  NBA: "basketball/nba",
  NHL: "hockey/nhl",
};

type AthleteInfo = { id: string; name: string; teamId: string; teamAbbr: string; teamName: string };

function teamNameMatches(displayName: string, nickname: string): boolean {
  const d = displayName.toLowerCase();
  const n = nickname.toLowerCase().trim();
  return d === n || d.endsWith(` ${n}`) || d.includes(n);
}

/** Split "Devils @ Golden Knights" into [away, home] nicknames. */
function gameTeams(game: string): [string, string] | null {
  const clean = game.replace(/\s*\([^)]*\)\s*$/, "");
  const parts = clean.split(/\s+@\s+|\s+vs\.?\s+/i);
  if (parts.length !== 2) return null;
  return [parts[0].trim(), parts[1].trim()];
}

async function resolveAthlete(sport: string, path: string, query: string, teams: [string, string] | null): Promise<AthleteInfo | null> {
  const cacheKey = `moyline:cheatsheet:athlete:${sport}:${query.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const cached = await cacheGet<AthleteInfo>(cacheKey);
  if (cached) return cached;

  const search = await fetchJson(
    `https://site.api.espn.com/apis/search/v2?query=${encodeURIComponent(query)}&limit=10`
  );
  const candidates: any[] = [];
  for (const group of search?.results || []) {
    if (group?.type !== "player") continue;
    for (const c of group.contents || []) {
      if (String(c.description || "").toUpperCase() === sport) candidates.push(c);
    }
  }
  const surname = query.split(/\s+/).pop()?.toLowerCase() || "";
  const scored = candidates
    .map((c) => {
      const name = String(c.displayName || "");
      const teamName = String(c.subtitle || "");
      let score = 0;
      if (name.toLowerCase() === query.toLowerCase()) score += 4;
      if (name.split(/\s+/).pop()?.toLowerCase() === surname) score += 2;
      if (teams && (teamNameMatches(teamName, teams[0]) || teamNameMatches(teamName, teams[1]))) score += 3;
      return { c, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;

  for (const { c } of scored.slice(0, 3)) {
    const id = String(c.uid || "").split("a:").pop();
    if (!id) continue;
    const gl = await fetchJson(`https://site.api.espn.com/apis/common/v3/sports/${path}/athletes/${id}/gamelog`);
    const events = gl?.events || {};
    const first = Object.values(events)[0] as any;
    const team = first?.team;
    if (!team?.id) continue;
    const info: AthleteInfo = {
      id,
      name: String(c.displayName || query),
      teamId: String(team.id),
      teamAbbr: String(team.abbreviation || ""),
      teamName: String(team.displayName || c.subtitle || ""),
    };
    await cacheSet(cacheKey, info, 30 * 24 * 3600);
    return info;
  }
  return null;
}

type SchedEvent = { id: string; date: string; completed: boolean; homeId: string; awayId: string };

async function teamSchedule(path: string, teamId: string, dateKey: string): Promise<SchedEvent[]> {
  const cacheKey = `moyline:cheatsheet:schedule:${path}:${teamId}:${dateKey}`;
  const cached = await cacheGet<SchedEvent[]>(cacheKey);
  if (cached) return cached;
  const d = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams/${teamId}/schedule`);
  const events: SchedEvent[] = [];
  for (const e of d?.events || []) {
    const comp = e?.competitions?.[0];
    if (!comp) continue;
    const home = (comp.competitors || []).find((x: any) => x.homeAway === "home");
    const away = (comp.competitors || []).find((x: any) => x.homeAway === "away");
    if (!home?.team?.id || !away?.team?.id) continue;
    events.push({
      id: String(e.id),
      date: String(e.date || ""),
      completed: Boolean(comp.status?.type?.completed ?? e.status?.type?.completed),
      homeId: String(home.team.id),
      awayId: String(away.team.id),
    });
  }
  await cacheSet(cacheKey, events, 6 * 3600);
  return events;
}
/** Exported (with statValue + getEventBox below) for the live-scores
 *  prop settler (optimization #67): the card's Won/Lost marker for props
 *  reads the same ESPN box-score rows this engine already fetches. */
export type EventBox = {
  dateET: string;
  homeId: string;
  awayId: string;
  homeAbbr: string;
  awayAbbr: string;
  players: Record<string, { name: string; teamId: string; stats: Record<string, number> }>;
};

function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Extract unified per-player stats from an ESPN summary box score. */
function extractBox(sport: string, summary: any, dateET: string): EventBox | null {
  const players: Record<string, { name: string; teamId: string; stats: Record<string, number> }> = {};
  const teamsMeta: Record<string, string> = {};
  for (const t of summary?.boxscore?.teams || []) {
    if (t?.team?.id) teamsMeta[String(t.team.id)] = String(t.team.abbreviation || "");
  }
  const put = (athleteId: string, name: string, teamId: string, kv: Record<string, number>) => {
    if (!players[athleteId]) players[athleteId] = { name, teamId, stats: {} };
    Object.assign(players[athleteId].stats, kv);
  };

  for (const teamBlock of summary?.boxscore?.players || []) {
    const teamId = String(teamBlock?.team?.id || "");
    for (const cat of teamBlock?.statistics || []) {
      const labels: string[] = cat?.labels || [];
      const keys: string[] = cat?.keys || cat?.names || [];
      for (const a of cat?.athletes || []) {
        const aid = String(a?.athlete?.id || "");
        if (!aid) continue;
        const name = String(a?.athlete?.displayName || "");
        const stats: string[] = (a?.stats || []).map((x: unknown) => String(x));
        const kv: Record<string, number> = {};
        if (sport === "NFL") {
          const byLabel: Record<string, string> = {};
          labels.forEach((l, i) => (byLabel[l] = stats[i] ?? ""));
          if (cat?.name === "passing") {
            const [cmp, att] = (byLabel["C/ATT"] || "0/0").split("/");
            kv.passCmp = num(cmp); kv.passAtt = num(att);
            kv.passYds = num(byLabel["YDS"]); kv.passTd = num(byLabel["TD"]); kv.passInt = num(byLabel["INT"]);
          } else if (cat?.name === "rushing") {
            kv.rushAtt = num(byLabel["CAR"]); kv.rushYds = num(byLabel["YDS"]); kv.rushTd = num(byLabel["TD"]);
          } else if (cat?.name === "receiving") {
            kv.rec = num(byLabel["REC"]); kv.recYds = num(byLabel["YDS"]); kv.recTd = num(byLabel["TD"]);
          }
        } else if (sport === "NBA") {
          const byKey: Record<string, string> = {};
          keys.forEach((k, i) => (byKey[k] = stats[i] ?? ""));
          kv.points = num(byKey["points"]);
          kv.rebounds = num(byKey["rebounds"] ?? byKey["totalRebounds"]);
          kv.assists = num(byKey["assists"]);
          kv.steals = num(byKey["steals"]);
          kv.blocks = num(byKey["blocks"]);
          kv.turnovers = num(byKey["turnovers"]);
          kv.threes = num((byKey["threePointFieldGoalsMade-threePointFieldGoalsAttempted"] || "0").split("-")[0]);
        } else if (sport === "NHL") {
          const byKey: Record<string, string> = {};
          keys.forEach((k, i) => (byKey[k] = stats[i] ?? ""));
          if (cat?.name === "goalies") {
            kv.saves = num(byKey["saves"]);
          } else {
            kv.goals = num(byKey["goals"]);
            kv.assists = num(byKey["assists"]);
            kv.shots = num(byKey["shotsTotal"]);
          }
        }
        if (Object.keys(kv).length > 0) put(aid, name, teamId, kv);
      }
    }
  }

  const comp = summary?.header?.competitions?.[0];
  const home = (comp?.competitors || []).find((x: any) => x.homeAway === "home");
  const away = (comp?.competitors || []).find((x: any) => x.homeAway === "away");
  if (!home?.team?.id || !away?.team?.id) return null;
  return {
    dateET,
    homeId: String(home.team.id),
    awayId: String(away.team.id),
    homeAbbr: String(home.team.abbreviation || teamsMeta[String(home.team.id)] || ""),
    awayAbbr: String(away.team.abbreviation || teamsMeta[String(away.team.id)] || ""),
    players,
  };
}

export async function getEventBox(sport: string, path: string, eventId: string, dateET: string): Promise<EventBox | null> {
  const cacheKey = `moyline:cheatsheet:event:${path}:${eventId}`;
  const cached = await cacheGet<EventBox>(cacheKey);
  if (cached) return cached;
  const summary = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${eventId}`);
  if (!summary) return null;
  const box = extractBox(sport, summary, dateET);
  if (box) await cacheSet(cacheKey, box, 30 * 24 * 3600);
  return box;
}

/* --------------------- board-props fallback --------------------- */

/**
 * NEVER-EMPTY RULE (user, 2026-10-30): the sheet must never show zero
 * options. When the brief's published props run thin, top the pool up from
 * the LIVE prop board (The Odds API player props for today's unstarted
 * NBA/NHL/NFL games) — real book lines and prices, same hit-rate engine.
 * Board legs are NOT MoyLine leans: they carry source "board", confidence 0,
 * and a badge in the UI. Fetched only when needed and cached 3h in Redis,
 * to keep Odds API credits in check.
 *
 * Ladder rungs (2026-11-05, user approved "a few credits", majors only):
 * the same per-event fetch also pulls the *_alternate player markets in a
 * SEPARATE request (failure-isolated: an unsupported alternate key can
 * only cost the ladder its rungs, never the board) and caches every
 * distinct priced line per player + market — best price + book per line —
 * for the Prop Explorer ladder (#49). No new cadence: same runs, same
 * events, wider market list on the alternate request only. Anytime-TD
 * markets stay out (binary — there is no ladder to climb).
 */
const BOARD_SPORTS: Record<
  string,
  {
    label: string;
    maxEvents: number;
    markets: Record<string, string>;
    /** Alternate market key -> the standard market key it ladders. */
    altMarkets: Record<string, string>;
  }
> = {
  basketball_nba: {
    label: "NBA",
    maxEvents: 8,
    markets: {
      player_points: "points",
      player_rebounds: "rebounds",
      player_assists: "assists",
      player_threes: "three-pointers made",
    },
    altMarkets: {
      player_points_alternate: "player_points",
      player_rebounds_alternate: "player_rebounds",
      player_assists_alternate: "player_assists",
    },
  },
  icehockey_nhl: {
    label: "NHL",
    maxEvents: 8,
    markets: {
      player_points: "points",
      player_goals: "goals",
      player_assists: "assists",
      player_shots_on_goal: "shots on goal",
    },
    altMarkets: {
      player_points_alternate: "player_points",
    },
  },
  americanfootball_nfl: {
    label: "NFL",
    maxEvents: 14,
    markets: {
      player_pass_yds: "pass yards",
      player_pass_tds: "pass TDs",
      player_rush_yds: "rush yards",
      player_reception_yds: "receiving yards",
      player_receptions: "receptions",
    },
    altMarkets: {
      player_pass_yds_alternate: "player_pass_yds",
      player_rush_yds_alternate: "player_rush_yds",
      player_reception_yds_alternate: "player_reception_yds",
    },
  },
};

function fmtPrice(price: number, book: string): string {
  return `${price > 0 ? "+" : ""}${price} (${book})`;
}

function formatStarts(iso: string): string {
  const t = new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${t.toLowerCase().replace(/\s+/g, "")} ET`;
}

export type BoardRungSide = { price: number; book: string };

/**
 * Every distinct priced line for one player + market from one board
 * fetch (standard + alternate markets merged), best price + book per
 * line and side. Consumed by buildLadder; the board fallback itself
 * only ever reads `picks`.
 */
export type BoardPlayerRungs = {
  game: string; // same label as the board picks, "Away @ Home (NBA)"
  player: string; // book description name
  market: string; // parsed internal market key (parseProp), e.g. "points"
  lines: { line: number; over?: BoardRungSide; under?: BoardRungSide }[];
};

type BoardPropsCache = { picks: FeedPick[]; rungs: BoardPlayerRungs[] };

const BOARD_CACHE_TTL_S = 3 * 3600;

function boardCacheKey(dateET: string): string {
  return `moyline:cheatsheet:boardprops:v2:${dateET}`;
}

/**
 * Board cache read with backward compatibility: v2 entries carry picks
 * + ladder rungs; pre-ladder entries under the legacy key are a plain
 * FeedPick[] and keep serving the board fallback until they expire
 * (≤3h) — they simply carry no rungs.
 */
async function readBoardCache(dateET: string): Promise<BoardPropsCache | null> {
  const v2 = await cacheGet<BoardPropsCache>(boardCacheKey(dateET));
  if (v2 && Array.isArray(v2.picks)) {
    return { picks: v2.picks, rungs: Array.isArray(v2.rungs) ? v2.rungs : [] };
  }
  const legacy = await cacheGet<FeedPick[]>(`moyline:cheatsheet:boardprops:${dateET}`);
  if (Array.isArray(legacy)) return { picks: legacy, rungs: [] };
  return null;
}

async function fetchBoardProps(dateET: string): Promise<FeedPick[]> {
  const cachedBoard = await readBoardCache(dateET);
  if (cachedBoard) return cachedBoard.picks;

  const apiKey = (process.env.ODDS_API_KEY || "").trim().replace(/^["']+|["']+$/g, "").replace(/\s+/g, "");
  if (!apiKey) return [];

  // Quota guard (user, 2026-11-02: never approach the limit): the prop
  // board is the priciest Odds API consumer per run — per-event calls at
  // 5-8 credits each (4-5 standard markets, plus the separate alternate
  // request at NBA +3 / NHL +1 / NFL +3 since 2026-11-05; Odds API cost
  // is markets × regions) — so it yields first. At or above the
  // conservative threshold the sheet serves the brief pool only; the
  // quota guard outranks the never-empty rule.
  const quota = await getQuotaState().catch(() => null);
  if (quota && quota.pct >= QUOTA_CONSERVATIVE_PCT) return [];

  let events: OddsEvent[] = [];
  try {
    events = (await getOddsCached()).events || [];
  } catch {
    return [];
  }
  const now = Date.now();
  const upcoming = events
    .filter(
      (e) =>
        BOARD_SPORTS[e.sport_key] &&
        new Date(e.commence_time).getTime() > now &&
        new Date(e.commence_time).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) === dateET
    )
    .sort((a, b) => (a.commence_time < b.commence_time ? -1 : 1));
  const counts = new Map<string, number>();
  const selected = upcoming.filter((e) => {
    const n = counts.get(e.sport_key) || 0;
    if (n >= BOARD_SPORTS[e.sport_key].maxEvents) return false;
    counts.set(e.sport_key, n + 1);
    return true;
  });
  if (selected.length === 0) return [];

  const picks: FeedPick[] = [];
  const allRungs: BoardPlayerRungs[] = [];
  await mapLimit(selected, 4, async (ev) => {
    const cfg = BOARD_SPORTS[ev.sport_key];
    const marketKeys = Object.keys(cfg.markets).join(",");
    const data = await fetchJson(
      `https://api.the-odds-api.com/v4/sports/${ev.sport_key}/events/${ev.id}/odds?apiKey=${apiKey}&regions=us&markets=${marketKeys}&oddsFormat=american`
    );
    if (!data?.bookmakers) return;
    const game = `${ev.away_team} @ ${ev.home_team} (${cfg.label})`;
    const starts = formatStarts(ev.commence_time);
    type Side = { price: number; book: string };
    // Ladder rungs for this event: every distinct priced line per
    // player + market (standard AND alternate markets), best price per
    // line and side. Kept apart from the consensus `table` below, whose
    // book-count logic decides the board legs and must not change.
    type RungCell = { over?: Side; under?: Side };
    const rungTable = new Map<string, Map<number, RungCell>>();
    const collectRungs = (payload: any, baseKeyFor: (mk: string) => string | undefined) => {
      for (const bm of payload?.bookmakers || []) {
        for (const mk of bm.markets || []) {
          const baseKey = baseKeyFor(mk.key);
          if (!baseKey) continue;
          for (const oc of mk.outcomes || []) {
            const player = String(oc.description || "").trim();
            if (!player || typeof oc.point !== "number") continue;
            if (oc.name !== "Over" && oc.name !== "Under") continue;
            const key = `${player}|${baseKey}`;
            if (!rungTable.has(key)) rungTable.set(key, new Map());
            const byPoint = rungTable.get(key)!;
            if (!byPoint.has(oc.point)) byPoint.set(oc.point, {});
            const cell = byPoint.get(oc.point)!;
            const side: Side = { price: oc.price, book: String(bm.title || bm.key || "Book") };
            if (oc.name === "Over" && (!cell.over || oc.price > cell.over.price)) cell.over = side;
            if (oc.name === "Under" && (!cell.under || oc.price > cell.under.price)) cell.under = side;
          }
        }
      }
    };
    collectRungs(data, (k) => (cfg.markets[k] ? k : undefined));
    // Alternate lines (#49 ladder): a separate request, so a rejected
    // or unsupported alternate key loses only rungs — the standard
    // board above is already safe. Same events, same cadence.
    const altKeys = Object.keys(cfg.altMarkets);
    if (altKeys.length > 0) {
      const altData = await fetchJson(
        `https://api.the-odds-api.com/v4/sports/${ev.sport_key}/events/${ev.id}/odds?apiKey=${apiKey}&regions=us&markets=${altKeys.join(",")}&oddsFormat=american`
      );
      if (altData?.bookmakers) collectRungs(altData, (k) => cfg.altMarkets[k]);
    }
    const table = new Map<string, Map<number, { over?: Side; under?: Side; books: number }>>();
    for (const bm of data.bookmakers) {
      for (const mk of bm.markets || []) {
        if (!cfg.markets[mk.key]) continue;
        for (const oc of mk.outcomes || []) {
          const player = String(oc.description || "").trim();
          if (!player || typeof oc.point !== "number") continue;
          const key = `${player}|${mk.key}`;
          if (!table.has(key)) table.set(key, new Map());
          const byPoint = table.get(key)!;
          if (!byPoint.has(oc.point)) byPoint.set(oc.point, { books: 0 });
          const cell = byPoint.get(oc.point)!;
          cell.books++;
          const side: Side = { price: oc.price, book: String(bm.title || bm.key || "Book") };
          if (oc.name === "Over" && (!cell.over || oc.price > cell.over.price)) cell.over = side;
          if (oc.name === "Under" && (!cell.under || oc.price > cell.under.price)) cell.under = side;
        }
      }
    }
    for (const [key, byPoint] of table) {
      const [player, marketKey] = key.split("|");
      const phrase = cfg.markets[marketKey];
      const consensus = [...byPoint.entries()].sort((a, b) => b[1].books - a[1].books)[0];
      if (!consensus) continue;
      const [point, cell] = consensus;
      if (!cell.over || !cell.under) continue;
      picks.push({
        game,
        play: `${player} Over ${point} ${phrase}`,
        price: fmtPrice(cell.over.price, cell.over.book),
        confidence: 0,
        market: "prop",
        starts,
      });
      picks.push({
        game,
        play: `${player} Under ${point} ${phrase}`,
        price: fmtPrice(cell.under.price, cell.under.book),
        confidence: 0,
        market: "prop",
        starts,
      });
    }
    // Flatten this event's rungs for the ladder cache. The parsed
    // market key comes from parseProp on the same play text shape the
    // board legs use, so fetch and ladder can never drift apart.
    for (const [key, byPoint] of rungTable) {
      const [player, baseKey] = key.split("|");
      const phrase = cfg.markets[baseKey];
      if (!phrase) continue;
      const parsed = parseProp(`${player} Over 0.5 ${phrase}`);
      if (!parsed) continue;
      const lines = [...byPoint.entries()]
        .map(([line, cell]) => ({ line, over: cell.over, under: cell.under }))
        .filter((l) => l.over || l.under)
        .sort((a, b) => a.line - b.line);
      if (lines.length === 0) continue;
      allRungs.push({ game, player, market: parsed.market, lines });
    }
  });

  await cacheSet(boardCacheKey(dateET), { picks, rungs: allRungs }, BOARD_CACHE_TTL_S);
  return picks;
}

/* ------------------------------ builder ------------------------------ */

function splitOf(rows: CheatRow[]): Split {
  const scored = rows.filter((r) => r.result !== "push");
  return { hits: scored.filter((r) => r.result === "hit").length, n: scored.length };
}

export async function buildCheatsheet(): Promise<CheatSheet | null> {
  const feed = await getPicksFeed();
  if (!feed) return null;
  // Pool gate (user's calls, 2026-10-30): the sheet builds from published
  // props at confidence 2 or above — conf-3 workhorse leans plus conf-2
  // leans included for this surface only (conf-2 legs are badged as such
  // in the UI). The main card's rules are untouched.
  const pool: FeedPick[] = [
    ...(feed.props || []),
    ...(feed.picks || []).filter((p) => p.market === "prop"),
  ].filter((p) => (p.confidence ?? 0) >= 2);
  const dateET = feed.date;

  type Work = { pick: FeedPick; parsed: ParsedProp; sport: string; path: string; source: "brief" | "board" };
  const toWork = (picks: FeedPick[], source: "brief" | "board"): Work[] => {
    const out: Work[] = [];
    for (const pick of picks) {
      const sport = sportFromGame(pick.game);
      const path = SPORT_PATH[sport];
      if (!path) continue;
      const parsed = parseProp(pick.play);
      if (!parsed) continue;
      out.push({ pick, parsed, sport, path, source });
    }
    return out;
  };
  const workKey = (w: Work) =>
    `${w.parsed.playerQuery.split(/\s+/).pop()?.toLowerCase()}|${w.parsed.market}|${w.parsed.line}|${w.parsed.direction}`;

  const feedWork = toWork(pool, "brief");
  let work = feedWork;
  let boardCandidates = 0;
  // Never-empty fallback: thin brief pool → top up from the live prop board.
  if (feedWork.length < 6) {
    const boardPicks = await fetchBoardProps(dateET);
    boardCandidates = boardPicks.length;
    const seen = new Set(feedWork.map(workKey));
    const players = new Set(feedWork.map((w) => `${w.sport}:${w.parsed.playerQuery.toLowerCase()}`));
    const extra: Work[] = [];
    for (const w of toWork(boardPicks, "board")) {
      if (seen.has(workKey(w))) continue;
      const pk = `${w.sport}:${w.parsed.playerQuery.toLowerCase()}`;
      if (!players.has(pk) && players.size >= 48) continue; // bound the ESPN workload
      players.add(pk);
      extra.push(w);
    }
    work = [...feedWork, ...extra];
  }

  const poolHash = work.map((w) => `${w.pick.game}|${w.pick.play}`).join(";;").length;
  const sheetKey = `moyline:cheatsheet:sheet:${dateET}:${poolHash}:${work.length}`;
  const cachedSheet = await cacheGet<CheatSheet>(sheetKey);
  if (cachedSheet) return cachedSheet;

  // Resolve players (one search + one gamelog per unique player).
  const uniqueQueries = new Map<string, Work>();
  for (const w of work) uniqueQueries.set(`${w.sport}:${w.parsed.playerQuery.toLowerCase()}`, w);
  const athletes = new Map<string, AthleteInfo | null>();
  await mapLimit([...uniqueQueries.entries()], 5, async ([key, w]) => {
    athletes.set(key, await resolveAthlete(w.sport, w.path, w.parsed.playerQuery, gameTeams(w.pick.game)));
  });

  // Load schedules + boxes per resolved team.
  const teamMeta = new Map<string, { path: string; sport: string }>();
  for (const [, w] of uniqueQueries) {
    const a = athletes.get(`${w.sport}:${w.parsed.playerQuery.toLowerCase()}`);
    if (a) teamMeta.set(a.teamId, { path: w.path, sport: w.sport });
  }

  const schedules = new Map<string, SchedEvent[]>();
  await mapLimit([...teamMeta.entries()], 5, async ([teamId, meta]) => {
    schedules.set(teamId, await teamSchedule(meta.path, teamId, dateET));
  });

  const boxJobs = new Map<string, { sport: string; path: string; dateET: string }>();
  for (const [teamId, meta] of teamMeta) {
    const sched = schedules.get(teamId) || [];
    const done = sched
      .filter((e) => e.completed && e.date.slice(0, 10) <= dateET)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, HISTORY_GAMES);
    for (const e of done) {
      if (!boxJobs.has(e.id)) {
        const et = new Date(e.date).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        boxJobs.set(e.id, { sport: meta.sport, path: meta.path, dateET: et });
      }
    }
  }
  const boxes = new Map<string, EventBox | null>();
  await mapLimit([...boxJobs.entries()], 6, async ([eventId, meta]) => {
    boxes.set(eventId, await getEventBox(meta.sport, meta.path, eventId, meta.dateET));
  });

  const legs: CheatLeg[] = [];
  for (const w of work) {
    const a = athletes.get(`${w.sport}:${w.parsed.playerQuery.toLowerCase()}`);
    if (!a) continue;
    const sched = schedules.get(a.teamId) || [];
    const todayEvent = sched.find((e) => !e.completed && e.date.slice(0, 10) === dateET)
      || sched.filter((e) => !e.completed).sort((x, y) => (x.date < y.date ? -1 : 1))[0];
    const oppId = todayEvent ? (todayEvent.homeId === a.teamId ? todayEvent.awayId : todayEvent.homeId) : null;
    const playerHome = todayEvent ? todayEvent.homeId === a.teamId : null;

    const history = sched
      .filter((e) => e.completed && e.date.slice(0, 10) <= dateET)
      .sort((x, y) => (x.date < y.date ? 1 : -1))
      .slice(0, HISTORY_GAMES);

    const rows: (CheatRow & { oppId: string })[] = [];
    for (const e of history) {
      const box = boxes.get(e.id);
      const rec = box?.players[a.id];
      if (!box || !rec) continue;
      const value = statValue(w.sport, w.parsed.market, rec.stats);
      if (value === null) continue;
      const home = box.homeId === rec.teamId;
      const result: CheatRow["result"] =
        value === w.parsed.line ? "push" : (w.parsed.direction === "over" ? value > w.parsed.line : value < w.parsed.line) ? "hit" : "miss";
      rows.push({
        date: box.dateET,
        opp: home ? box.awayAbbr : box.homeAbbr,
        home,
        value,
        result,
        oppId: home ? box.awayId : box.homeId,
      });
    }
    if (rows.length < 3) continue; // too thin to publish a rate — stay honest

    const l5 = splitOf(rows.slice(0, 5));
    const l10 = splitOf(rows.slice(0, 10));
    const all = splitOf(rows);
    const vsOpp = oppId ? splitOf(rows.filter((r) => r.oppId === oppId)) : null;
    const venue = playerHome !== null ? splitOf(rows.filter((r) => r.home === playerHome)) : null;
    let streak = 0;
    for (const r of rows) {
      if (r.result === "hit") streak++;
      else break;
    }
    const avg10 = rows.slice(0, 10).reduce((s, r) => s + r.value, 0) / Math.max(1, Math.min(10, rows.length));
    legs.push({
      id: `${w.pick.game}|${w.pick.play}`,
      game: w.pick.game,
      sport: w.sport,
      starts: w.pick.starts,
      play: w.pick.play,
      price: w.pick.price,
      confidence: w.pick.confidence ?? 0,
      edge_cents: w.pick.edge_cents,
      win_prob: w.pick.win_prob,
      source: w.source,
      player: a.name,
      team: a.teamAbbr,
      direction: w.parsed.direction,
      line: w.parsed.line,
      lineLabel: w.parsed.lineLabel,
      market: w.parsed.market,
      marketLabel: w.parsed.marketLabel,
      splits: {
        l5,
        l10,
        all,
        vsOpp: vsOpp && vsOpp.n > 0 ? vsOpp : null,
        venue: venue && venue.n > 0 ? venue : null,
      },
      streak,
      avg10: Math.round(avg10 * 10) / 10,
      rows: rows.map(({ oppId: _o, ...r }) => r),
    });
  }

  legs.sort((x, y) => {
    const rx = x.splits.l10.n ? x.splits.l10.hits / x.splits.l10.n : 0;
    const ry = y.splits.l10.n ? y.splits.l10.hits / y.splits.l10.n : 0;
    return ry - rx || y.splits.l10.n - x.splits.l10.n;
  });

  const sheet: CheatSheet = { date: dateET, legs, poolSize: pool.length + boardCandidates, covered: legs.length };
  await cacheSet(sheetKey, sheet, 30 * 60);
  return sheet;
}

/* --------------------------- prop ladder --------------------------- */

/**
 * Prop Explorer ladder (optimization #49, Rithmm-style milestone ladder
 * under MoyLine honesty rules): for one sheet leg, the alternate lines
 * ("rungs") for the same player + market, each with the best real price
 * we already hold in cache and the player's REAL hit rate at that rung
 * from the same ESPN game logs the sheet was built from (leg.rows).
 * Nothing is modeled and nothing new is pulled:
 * - Prices come only from (a) the leg's own published price tag,
 *   (b) the board-props Redis cache fetchBoardProps already writes —
 *   the main book line at the board's consensus point, best across
 *   books — and (c) that same cache's ladder rungs: since 2026-11-05
 *   the board fetch also pulls the *_alternate player markets (majors
 *   only, separate failure-isolated request) and caches every distinct
 *   priced line per player + market, best price + book per line. The
 *   cached game-odds snapshot carries h2h/spreads/totals only (no
 *   player props at all), and no Odds API call is made here. A rung
 *   exists only when a real cached price exists for it.
 * - Hit rates use the milestone rule: an Over rung is reached when the
 *   logged stat is >= the rung, an Under rung when it is <= the rung
 *   (a 24.5 over and a stat of 25 are the same event; landing exactly on
 *   a whole-number rung counts as reaching it). Rates are suppressed
 *   entirely below 3 logged games, same floor as the sheet itself.
 */

export type LadderRung = {
  line: number;
  lineLabel: string;
  price: number | null; // american, for the leg's side
  priceLabel: string; // "+100" / "-110" (raw tag when unparseable)
  book: string | null;
  isLean: boolean; // the published leg's own line
  l10: Split | null;
  l5: Split | null;
};

export type CheatLadder = {
  id: string;
  player: string;
  marketLabel: string;
  direction: "over" | "under";
  line: number;
  loggedGames: number;
  rungs: LadderRung[];
};

/** Hit split at an arbitrary rung from raw game-log values (most recent first). */
export function ladderSplit(
  values: number[],
  line: number,
  direction: "over" | "under",
  window: number
): Split {
  const w = values.slice(0, window);
  const hits = w.filter((v) => (direction === "over" ? v >= line : v <= line)).length;
  return { hits, n: w.length };
}

/** Parse a "-110 (DraftKings)" / "+120 (Caesars)" price tag. */
function parsePriceTag(raw: string): { price: number; book: string } | null {
  const m = (raw || "").match(/([+-]?\d+)\s*\(([^)]+)\)/);
  if (!m) return null;
  const price = parseInt(m[1], 10);
  if (!Number.isFinite(price) || price === 0) return null;
  return { price, book: m[2].trim() };
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Board-cache player names are book descriptions; the leg's player is
 * the ESPN-resolved name. Exact normalized match, else surname + first
 * initial — conservative on purpose (a missed rung beats a wrong one). */
function playerNameMatches(boardName: string, legName: string): boolean {
  const a = normalizeName(boardName);
  const b = normalizeName(legName);
  if (!a || !b) return false;
  if (a === b) return true;
  const at = a.split(" ");
  const bt = b.split(" ");
  return (
    at[at.length - 1] === bt[bt.length - 1] &&
    at[0].charAt(0) === bt[0].charAt(0) &&
    // Suffixes ("jr", "sr", "ii") ride along as the last token on both
    // sides or neither; a one-sided suffix means a different player.
    at.length === bt.length
  );
}

function fmtRungLine(line: number): string {
  return line % 1 === 0 ? String(Math.round(line)) : String(line);
}

export async function buildLadder(leg: CheatLeg, dateET: string): Promise<CheatLadder> {
  type Cand = { price: number; book: string };
  const byPoint = new Map<number, Cand>();
  // Higher american number always pays more (+120 > +100, -110 > -120) —
  // the same "best price" rule the board fetch applies.
  const offer = (point: number, cand: Cand) => {
    const cur = byPoint.get(point);
    if (!cur || cand.price > cur.price) byPoint.set(point, cand);
  };

  // (b) Board-props cache: best book prices at the board's consensus
  // point for this player + market + side — an extra rung when that
  // point differs from the published line, a better price when it lands
  // on it. Cache-only: this key exists only on days the sheet topped up
  // from the board, and reading it costs no Odds API credits.
  const boardCache = await readBoardCache(dateET);
  const board = boardCache?.picks || [];
  for (const pick of board) {
    if (sportFromGame(pick.game) !== leg.sport) continue;
    const parsed = parseProp(pick.play);
    if (!parsed || parsed.market !== leg.market || parsed.direction !== leg.direction) continue;
    if (!playerNameMatches(parsed.playerQuery, leg.player)) continue;
    const tag = parsePriceTag(pick.price);
    if (tag) offer(parsed.line, tag);
  }

  // (c) Ladder rungs from the same board fetch: every distinct priced
  // line for this player + market across the standard and alternate
  // markets, best price per line for the leg's side. Pure cache —
  // pre-ladder (legacy) cache entries carry no rungs and simply skip.
  for (const entry of boardCache?.rungs || []) {
    if (sportFromGame(entry.game) !== leg.sport) continue;
    if (entry.market !== leg.market) continue;
    if (!playerNameMatches(entry.player, leg.player)) continue;
    for (const ln of entry.lines) {
      const side = leg.direction === "over" ? ln.over : ln.under;
      if (side) offer(ln.line, { price: side.price, book: side.book });
    }
  }

  // (a) The leg's own published price — always a real price for the
  // main line, for brief leans and board legs alike.
  const own = parsePriceTag(leg.price);
  if (own) offer(leg.line, own);

  const points = [...byPoint.keys()];
  if (!points.some((p) => Math.abs(p - leg.line) < 1e-9)) points.push(leg.line);
  points.sort((a, b) => a - b);

  const values = leg.rows.map((r) => r.value);
  const rated = leg.rows.length >= 3; // sheet floor — never rate a thinner log
  const rungs: LadderRung[] = points.map((point) => {
    const isLean = Math.abs(point - leg.line) < 1e-9;
    const cand = byPoint.get(point);
    return {
      line: point,
      lineLabel: isLean ? leg.lineLabel : fmtRungLine(point),
      price: cand ? cand.price : null,
      priceLabel: cand ? fmtAmerican(cand.price) : isLean ? leg.price : "—",
      book: cand ? cand.book : null,
      isLean,
      l10: rated ? ladderSplit(values, point, leg.direction, 10) : null,
      l5: rated ? ladderSplit(values, point, leg.direction, 5) : null,
    };
  });

  return {
    id: leg.id,
    player: leg.player,
    marketLabel: leg.marketLabel,
    direction: leg.direction,
    line: leg.line,
    loggedGames: leg.rows.length,
    rungs,
  };
}

/**
 * Live quote for one feed prop pick (optimization #52, the /picks
 * edge-gone badge), from the board-props cache ONLY — the same sources
 * buildLadder reads: (b) the cache's consensus board picks (the board's
 * current main line for the player + market, best price across books)
 * and (c) its ladder rungs (every distinct priced line, best price per
 * line for the pick's side). Cache-only: this reads the key
 * fetchBoardProps already writes and never triggers a fetch, so on
 * days the sheet never topped up from the board there is simply no
 * quote and the caller shows nothing. Matching is buildLadder's: same
 * sport, same parsed market + direction, conservative player-name
 * match (a missed quote beats a wrong one).
 */
export async function livePropQuote(
  pick: FeedPick,
  dateET: string
): Promise<PropLiveQuote | null> {
  const parsed = parseProp(pick.play);
  if (!parsed) return null;
  const boardCache = await readBoardCache(dateET);
  if (!boardCache) return null;
  const sport = sportFromGame(pick.game);

  let mainLine: number | null = null;
  let mainPrice: number | null = null;
  const byLine = new Map<number, number>();
  const offer = (line: number, price: number) => {
    const cur = byLine.get(line);
    if (cur === undefined || price > cur) byLine.set(line, price);
  };

  for (const bp of boardCache.picks) {
    if (sportFromGame(bp.game) !== sport) continue;
    const bpParsed = parseProp(bp.play);
    if (!bpParsed || bpParsed.market !== parsed.market || bpParsed.direction !== parsed.direction) continue;
    if (!playerNameMatches(bpParsed.playerQuery, parsed.playerQuery)) continue;
    const tag = parsePriceTag(bp.price);
    if (!tag) continue;
    if (mainLine === null) {
      mainLine = bpParsed.line;
      mainPrice = tag.price;
    }
    offer(bpParsed.line, tag.price);
  }

  for (const entry of boardCache.rungs) {
    if (sportFromGame(entry.game) !== sport) continue;
    if (entry.market !== parsed.market) continue;
    if (!playerNameMatches(entry.player, parsed.playerQuery)) continue;
    for (const ln of entry.lines) {
      const side = parsed.direction === "over" ? ln.over : ln.under;
      if (side) offer(ln.line, side.price);
    }
  }

  if (mainLine === null && byLine.size === 0) return null;
  const priceByLine: Record<number, number> = {};
  for (const [line, price] of byLine) priceByLine[line] = price;
  return { mainLine, mainPrice, priceByLine };
}
