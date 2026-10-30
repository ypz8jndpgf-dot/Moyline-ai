import { Redis } from "@upstash/redis";
import { getPicksFeed, sportFromGame, type FeedPick } from "@/lib/picks";

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
function statValue(sport: string, market: string, s: Record<string, number>): number | null {
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
type EventBox = {
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

async function getEventBox(sport: string, path: string, eventId: string, dateET: string): Promise<EventBox | null> {
  const cacheKey = `moyline:cheatsheet:event:${path}:${eventId}`;
  const cached = await cacheGet<EventBox>(cacheKey);
  if (cached) return cached;
  const summary = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${eventId}`);
  if (!summary) return null;
  const box = extractBox(sport, summary, dateET);
  if (box) await cacheSet(cacheKey, box, 30 * 24 * 3600);
  return box;
}

/* ------------------------------ builder ------------------------------ */

function splitOf(rows: CheatRow[]): Split {
  const scored = rows.filter((r) => r.result !== "push");
  return { hits: scored.filter((r) => r.result === "hit").length, n: scored.length };
}

export async function buildCheatsheet(): Promise<CheatSheet | null> {
  const feed = await getPicksFeed();
  if (!feed) return null;
  const pool: FeedPick[] = [
    ...(feed.props || []),
    ...(feed.picks || []).filter((p) => p.market === "prop"),
  ];
  const dateET = feed.date;

  const poolHash = pool.map((p) => `${p.game}|${p.play}`).join(";;").length;
  const sheetKey = `moyline:cheatsheet:sheet:${dateET}:${poolHash}:${pool.length}`;
  const cachedSheet = await cacheGet<CheatSheet>(sheetKey);
  if (cachedSheet) return cachedSheet;

  type Work = { pick: FeedPick; parsed: ParsedProp; sport: string; path: string };
  const work: Work[] = [];
  for (const pick of pool) {
    const sport = sportFromGame(pick.game);
    const path = SPORT_PATH[sport];
    if (!path) continue;
    const parsed = parseProp(pick.play);
    if (!parsed) continue;
    work.push({ pick, parsed, sport, path });
  }

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

  const sheet: CheatSheet = { date: dateET, legs, poolSize: pool.length, covered: legs.length };
  await cacheSet(sheetKey, sheet, 30 * 60);
  return sheet;
}
