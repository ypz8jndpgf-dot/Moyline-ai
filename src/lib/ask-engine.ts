/**
 * Ask MoyAI conversation engine.
 *
 * Pure, dependency-free module: given the live odds board (cached), the
 * openings snapshot, today's picks feed, and the showcase track record, it
 * turns a natural-language question + recent chat history into a
 * natural-language reply. There is no LLM behind this — every number in a
 * reply is composed from the real data passed in, and when the data doesn't
 * cover something the reply says so plainly. Nothing is invented.
 */

export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  gameIds?: string[];
};

export type AskPick = {
  game: string;
  play: string;
  price: string;
  confidence: number;
  star?: boolean;
  reasoning?: string;
  writeup?: string;
  edge_cents?: number;
  starts?: string;
};

export type RecordStat = { w: number; l: number; p: number; pct: number | null };

export type AskRecords = {
  allTime: RecordStat;
  stars: RecordStat;
  sinceRecal: RecordStat;
  last7: RecordStat;
  showStars: boolean;
  showSinceRecal: boolean;
  showLast7: boolean;
};

export type AskData = {
  events: any[];
  openings: Record<string, any>;
  card: AskPick[];
  props: AskPick[];
  teaser: { legs: string[]; points: number; confidence: number } | null;
  parlay: { legs: string[]; odds?: string; confidence: number } | null;
  /** Weekend lookahead teaser from the feed (Thu/Fri briefs), if posted. */
  lookaheadTeaser?: {
    legs: string[];
    points: number;
    confidence: number;
    target_date?: string;
  } | null;
  records: AskRecords | null;
};

export type Game = {
  id: string;
  sport: string;
  home: string;
  away: string;
  commence: string;
  spread?: { home: number; away: number };
  total?: { line: number };
  ml?: { home: number; away: number };
};

/* ------------------------------------------------------------------ */
/* Team matching                                                       */
/* ------------------------------------------------------------------ */

const ALIASES: Record<string, string> = {
  // NFL
  kc: "kansas city", chiefs: "kansas city",
  buf: "buffalo", bills: "buffalo",
  phi: "philadelphia", eagles: "philadelphia",
  dal: "dallas", cowboys: "dallas",
  gb: "green bay", packers: "green bay",
  sf: "san francisco", niners: "san francisco", "49ers": "san francisco",
  bal: "baltimore", ravens: "baltimore",
  cin: "cincinnati", bengals: "cincinnati",
  cle: "cleveland", browns: "cleveland",
  pit: "pittsburgh", steelers: "pittsburgh",
  ne: "new england", pats: "new england", patriots: "new england",
  nyj: "ny jets", nyjets: "ny jets",
  nyg: "ny giants",
  mia: "miami", dolphins: "miami", fins: "miami",
  jax: "jacksonville", jags: "jacksonville", jaguars: "jacksonville",
  hou: "houston", texans: "houston",
  ten: "tennessee", titans: "tennessee",
  ind: "indianapolis", colts: "indianapolis",
  den: "denver", broncos: "denver",
  lv: "las vegas", raiders: "las vegas",
  lac: "chargers", sd: "chargers",
  lar: "rams", rams: "los angeles",
  sea: "seattle", seahawks: "seattle",
  ari: "arizona", cards: "arizona", cardinals: "arizona",
  min: "minnesota", vikings: "minnesota", vikes: "minnesota",
  chi: "chicago", bears: "chicago",
  det: "detroit", lions: "detroit",
  atl: "atlanta", falcons: "atlanta",
  car: "carolina", panthers: "carolina",
  no: "new orleans", saints: "new orleans",
  tb: "tampa bay", bucs: "tampa bay", buccaneers: "tampa bay",
  wsh: "washington", commanders: "washington",
  // NBA
  lal: "lakers", lacnba: "clippers",
  bos: "celtics", nyk: "knicks",
  gsw: "warriors", dubs: "warriors",
  // MLB
  nyy: "yankees", bosox: "red sox",
  lad: "dodgers",
  // NHL
  tbnhl: "lightning", edm: "oilers",
  // Soccer
  arsenal: "arsenal", gunners: "arsenal",
  city: "manchester city",
  utd: "manchester united",
  pool: "liverpool", reds: "liverpool",
  spurs: "tottenham",
  chelsea: "chelsea", blues: "chelsea",
};

export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function expandAliases(question: string): string {
  let q = norm(question);
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    const re = new RegExp(`\\b${alias}\\b`, "g");
    q = q.replace(re, canonical);
  }
  return q;
}

export function extractGame(ev: any): Game {
  const game: Game = {
    id: ev.id,
    sport: ev.sport_key || ev.sport || "",
    home: ev.home_team,
    away: ev.away_team,
    commence: ev.commence_time,
  };

  const spreads: { home: number[]; away: number[] } = { home: [], away: [] };
  const totals: number[] = [];
  const mls: { home: number[]; away: number[] } = { home: [], away: [] };

  for (const bm of ev.bookmakers || []) {
    for (const m of bm.markets || []) {
      if (m.key === "spreads") {
        for (const o of m.outcomes || []) {
          if (o.name === ev.home_team && o.point !== undefined) spreads.home.push(o.point);
          if (o.name === ev.away_team && o.point !== undefined) spreads.away.push(o.point);
        }
      } else if (m.key === "totals") {
        for (const o of m.outcomes || []) {
          if (o.point !== undefined) totals.push(o.point);
        }
      } else if (m.key === "h2h") {
        for (const o of m.outcomes || []) {
          if (o.name === ev.home_team) mls.home.push(o.price);
          if (o.name === ev.away_team) mls.away.push(o.price);
        }
      }
    }
  }

  const mode = (arr: number[]) => {
    if (!arr.length) return undefined;
    const counts = new Map<number, number>();
    for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  const bestPrice = (arr: number[]) => (arr.length ? Math.max(...arr) : undefined);

  const hs = mode(spreads.home);
  const as = mode(spreads.away);
  if (hs !== undefined && as !== undefined) game.spread = { home: hs, away: as };

  const tl = mode(totals);
  if (tl !== undefined) game.total = { line: tl };

  const hm = bestPrice(mls.home);
  const am = bestPrice(mls.away);
  if (hm !== undefined && am !== undefined) game.ml = { home: hm, away: am };

  return game;
}

/**
 * Words that carry no team signal. The original matcher scored raw substring
 * hits, so "and" matched "Orl**and**o" and conversational follow-ups false-
 * matched random games. Words are matched per-team with graded rules instead
 * (see wordHit), and scoring requires a real team-word hit.
 */
const STOPWORDS = new Set([
  "the", "and", "who", "what", "about", "game", "games", "tonight", "today",
  "favored", "favorite", "favourite", "wins", "win", "winner", "vs", "at",
  "in", "on", "of", "is", "are", "was", "were", "one", "two", "three",
  "late", "early", "first", "last", "that", "this", "its", "tell", "show",
  "give", "please", "play", "playing", "team", "teams", "match", "matchup",
  "line", "lines", "odds", "spread", "total", "moneyline", "over", "under",
  "how", "much", "many", "does", "did", "you", "your", "they", "them",
  "their", "with", "for", "from", "been", "has", "have", "had", "will",
  "would", "should", "can", "could", "our", "out", "look", "looking",
  "like", "want", "need", "know", "think", "take", "lean", "pick", "picks",
  "bet", "bets", "betting", "good", "best", "any", "some", "more", "most",
  "other", "another", "just", "really", "value", "doing", "going",
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday",
  "saturday", "tomorrow", "yesterday", "weekend", "week", "series",
  "world", "star", "teaser", "parlay",
]);

/** Levenshtein distance, capped — only used for the ≤1 fuzzy rule. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Graded hit of one question word against one team's words.
 * Nickname (last word) exact = 4; other team word exact = 3; word that is a
 * suffix of a team word ("wolves" in "timberwolves") = 3; one-typo fuzzy
 * (5+ letters, distance ≤1: "celtcs", "lightening") = 3; prefix of a team
 * word (5+ letters only — "card" must NOT hit "Cardinals", "bowl" must NOT
 * hit "Bowling") = 2.
 */
function wordHit(word: string, teamWords: string[]): number {
  let best = 0;
  const nick = teamWords[teamWords.length - 1];
  for (const tw of teamWords) {
    if (word === tw) best = Math.max(best, tw === nick ? 4 : 3);
    else if (word.length >= 5 && tw.endsWith(word)) best = Math.max(best, 3);
    else if (word.length >= 5 && tw.startsWith(word)) best = Math.max(best, 2);
    else if (word.length >= 6 && tw.includes(word)) best = Math.max(best, 2);
    else if (word.length >= 5 && editDistance(word, tw) <= 1) best = Math.max(best, 3);
  }
  return best;
}

function questionWords(question: string): string[] {
  return expandAliases(question)
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function findGames(question: string, events: any[]): Game[] {
  const words = questionWords(question);
  if (!words.length) return [];
  const today = todayET();
  const tomorrow = addDaysET(today, 1);
  const scored: { ev: any; score: number; commence: string }[] = [];

  for (const ev of events) {
    const homeWords = norm(ev.home_team || "").split(" ").filter(Boolean);
    const awayWords = norm(ev.away_team || "").split(" ").filter(Boolean);
    let homeScore = 0;
    let awayScore = 0;
    for (const w of words) {
      homeScore += wordHit(w, homeWords);
      awayScore += wordHit(w, awayWords);
    }
    const maxTeam = Math.max(homeScore, awayScore);
    if (maxTeam < 3) continue;
    let score = maxTeam + (Math.min(homeScore, awayScore) >= 3 ? 3 : 0);
    const d = etDateOf(ev.commence_time);
    if (d === today) score += 2;
    else if (d === tomorrow) score += 1;
    if (score >= 4) scored.push({ ev, score, commence: ev.commence_time });
  }

  scored.sort(
    (a, b) => b.score - a.score || new Date(a.commence).getTime() - new Date(b.commence).getTime()
  );
  return scored.slice(0, 3).map(({ ev }) => extractGame(ev));
}

function gameById(id: string, events: any[]): Game | null {
  const ev = events.find((e: any) => e.id === id);
  return ev ? extractGame(ev) : null;
}

/** Check if this game is on today's card */
export function findCardPick(game: Game, card: AskPick[]): AskPick | null {
  if (!card || card.length === 0) return null;
  const gh = norm(game.home);
  const ga = norm(game.away);
  for (const pick of card) {
    const label = norm(pick.game || "");
    const homeWords = gh.split(" ").filter((w) => w.length >= 4);
    const awayWords = ga.split(" ").filter((w) => w.length >= 4);
    const homeHit = homeWords.some((w) => label.includes(w));
    const awayHit = awayWords.some((w) => label.includes(w));
    if (homeHit && awayHit) return pick;
    if (
      homeWords.length > 0 &&
      label.includes(homeWords[homeWords.length - 1]) &&
      label.includes(awayWords[awayWords.length - 1] || "")
    )
      return pick;
  }
  return null;
}

/** Board games that carry a card pick, in card order — for follow-up context. */
function cardGameIds(data: AskData): string[] {
  const ids: string[] = [];
  for (const ev of data.events) {
    const g = extractGame(ev);
    if (findCardPick(g, data.card)) ids.push(g.id);
  }
  // Preserve card order: sort ids by their pick's position on the card.
  const order = new Map<string, number>();
  data.card.forEach((p, i) => {
    const g = data.events
      .map((ev) => extractGame(ev))
      .find((g) => findCardPick(g, [p]));
    if (g) order.set(g.id, i);
  });
  return ids.sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

/* ------------------------------------------------------------------ */
/* Known pro teams — honest "not playing" answers + forced resolution  */
/* ------------------------------------------------------------------ */

const KNOWN_TEAMS: [string, string][] = [
  // NFL
  ["arizona", "cardinals"], ["atlanta", "falcons"], ["baltimore", "ravens"],
  ["buffalo", "bills"], ["carolina", "panthers"], ["chicago", "bears"],
  ["cincinnati", "bengals"], ["cleveland", "browns"], ["dallas", "cowboys"],
  ["denver", "broncos"], ["detroit", "lions"], ["green bay", "packers"],
  ["houston", "texans"], ["indianapolis", "colts"], ["jacksonville", "jaguars"],
  ["kansas city", "chiefs"], ["las vegas", "raiders"], ["los angeles", "chargers"],
  ["los angeles", "rams"], ["miami", "dolphins"], ["minnesota", "vikings"],
  ["new england", "patriots"], ["new orleans", "saints"], ["new york", "giants"],
  ["new york", "jets"], ["philadelphia", "eagles"], ["pittsburgh", "steelers"],
  ["san francisco", "49ers"], ["seattle", "seahawks"], ["tampa bay", "buccaneers"],
  ["tennessee", "titans"], ["washington", "commanders"],
  // NBA
  ["atlanta", "hawks"], ["boston", "celtics"], ["brooklyn", "nets"],
  ["charlotte", "hornets"], ["chicago", "bulls"], ["cleveland", "cavaliers"],
  ["dallas", "mavericks"], ["denver", "nuggets"], ["detroit", "pistons"],
  ["golden state", "warriors"], ["houston", "rockets"], ["indiana", "pacers"],
  ["los angeles", "clippers"], ["los angeles", "lakers"], ["memphis", "grizzlies"],
  ["miami", "heat"], ["milwaukee", "bucks"], ["minnesota", "timberwolves"],
  ["new orleans", "pelicans"], ["new york", "knicks"], ["oklahoma city", "thunder"],
  ["orlando", "magic"], ["philadelphia", "76ers"], ["phoenix", "suns"],
  ["portland", "trail blazers"], ["sacramento", "kings"], ["san antonio", "spurs"],
  ["toronto", "raptors"], ["utah", "jazz"], ["washington", "wizards"],
  // NHL
  ["anaheim", "ducks"], ["boston", "bruins"], ["buffalo", "sabres"],
  ["calgary", "flames"], ["carolina", "hurricanes"], ["chicago", "blackhawks"],
  ["colorado", "avalanche"], ["columbus", "blue jackets"], ["dallas", "stars"],
  ["detroit", "red wings"], ["edmonton", "oilers"], ["florida", "panthers"],
  ["los angeles", "kings"], ["minnesota", "wild"], ["montreal", "canadiens"],
  ["nashville", "predators"], ["new jersey", "devils"], ["new york", "islanders"],
  ["new york", "rangers"], ["ottawa", "senators"], ["philadelphia", "flyers"],
  ["pittsburgh", "penguins"], ["san jose", "sharks"], ["seattle", "kraken"],
  ["st louis", "blues"], ["tampa bay", "lightning"], ["toronto", "maple leafs"],
  ["utah", "mammoth"], ["vancouver", "canucks"], ["vegas", "golden knights"],
  ["washington", "capitals"], ["winnipeg", "jets"],
  // MLB
  ["arizona", "diamondbacks"], ["athletics", "athletics"], ["atlanta", "braves"],
  ["baltimore", "orioles"], ["boston", "red sox"], ["chicago", "cubs"],
  ["chicago", "white sox"], ["cincinnati", "reds"], ["cleveland", "guardians"],
  ["colorado", "rockies"], ["detroit", "tigers"], ["houston", "astros"],
  ["kansas city", "royals"], ["los angeles", "angels"], ["los angeles", "dodgers"],
  ["miami", "marlins"], ["milwaukee", "brewers"], ["minnesota", "twins"],
  ["new york", "mets"], ["new york", "yankees"], ["philadelphia", "phillies"],
  ["pittsburgh", "pirates"], ["san diego", "padres"], ["san francisco", "giants"],
  ["seattle", "mariners"], ["st louis", "cardinals"], ["tampa bay", "rays"],
  ["texas", "rangers"], ["toronto", "blue jays"], ["washington", "nationals"],
];

type KnownTeam = { city: string; nick: string; name: string };

/**
 * Strong reference to a known pro team: the full "city + nickname" phrase,
 * or a nickname that belongs to exactly one known team ("yankees",
 * "patriots", "celtics"). Returns null when the reference is weak or the
 * nickname is shared (bare "jets", "kings", "rangers", "giants"…).
 */
function knownTeamRef(q: string): KnownTeam | null {
  for (const [city, nick] of KNOWN_TEAMS) {
    if (q.includes(`${city} ${nick}`)) return { city, nick, name: `${city} ${nick}` };
  }
  const byNick = new Map<string, KnownTeam[]>();
  for (const [city, nick] of KNOWN_TEAMS) {
    const t = { city, nick, name: `${city} ${nick}` };
    byNick.set(nick, [...(byNick.get(nick) || []), t]);
  }
  for (const [nick, teams] of byNick) {
    if (teams.length === 1 && new RegExp(`\\b${nick.replace(/ /g, "\\s")}\\b`).test(q)) {
      return teams[0];
    }
  }
  return null;
}

/** Find a board game involving a known team (nickname word must appear). */
function gameForTeam(team: KnownTeam, events: any[]): Game | null {
  const nickTail = team.nick.split(" ").pop() || team.nick;
  const cityTail = team.city.split(" ").pop() || team.city;
  const candidates = events
    .map((ev) => extractGame(ev))
    .filter((g) => {
      const names = [norm(g.home), norm(g.away)];
      return names.some((n) => n.includes(nickTail) && (n.includes(team.city) || n.includes(cityTail)));
    })
    .sort((a, b) => new Date(a.commence).getTime() - new Date(b.commence).getTime());
  return candidates[0] || null;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Sport intent                                                        */
/* ------------------------------------------------------------------ */

type SportIntent = {
  /** sport_key matcher */
  matchKey: (key: string) => boolean;
  label: string;
  /** League labels as they appear in feed game strings, e.g. "Duke @ Virginia (CFB)" */
  feedLabels: string[];
  patterns: RegExp[];
};

const SPORT_INTENTS: SportIntent[] = [
  {
    matchKey: (k) => k === "americanfootball_nfl",
    label: "NFL",
    feedLabels: ["NFL"],
    patterns: [/\bnfl\b/, /\bpro football\b/],
  },
  {
    matchKey: (k) => k === "americanfootball_ncaaf",
    label: "college football",
    feedLabels: ["CFB", "NCAAF"],
    patterns: [/\bcfb\b/, /\bncaaf\b/, /\bcollege football\b/],
  },
  {
    matchKey: (k) => k === "basketball_ncaab",
    label: "college basketball",
    feedLabels: ["NCAAB", "CBB"],
    patterns: [/\bncaab\b/, /\bcollege (basketball|hoops)\b/, /\bmarch madness\b/],
  },
  {
    matchKey: (k) => k === "basketball_wnba",
    label: "WNBA",
    feedLabels: ["WNBA"],
    patterns: [/\bwnba\b/],
  },
  {
    matchKey: (k) => k === "basketball_nba",
    label: "NBA",
    feedLabels: ["NBA"],
    patterns: [/\bnba\b/, /\bbasketball\b/],
  },
  {
    matchKey: (k) => k === "icehockey_nhl",
    label: "NHL",
    feedLabels: ["NHL"],
    patterns: [/\bnhl\b/, /\bhockey\b/],
  },
  {
    matchKey: (k) => k === "baseball_mlb",
    label: "MLB",
    feedLabels: ["MLB"],
    patterns: [/\bmlb\b/, /\bbaseball\b/, /\bworld series\b/],
  },
  {
    matchKey: (k) => k.startsWith("soccer"),
    label: "soccer",
    feedLabels: ["SOCCER", "EPL", "MLS", "LA LIGA", "BUNDESLIGA", "SERIE A", "LIGUE 1", "UCL", "CHAMPIONS LEAGUE", "BRAZIL SERIE A", "SÉRIE A"],
    patterns: [
      /\bsoccer\b/, /\bepl\b/, /\bpremier league\b/, /\bmls\b/, /\bla liga\b/,
      /\bbundesliga\b/, /\bserie a\b/, /\bligue (1|one)\b/, /\bchampions league\b/,
    ],
  },
];

function detectSport(q: string): SportIntent | null {
  for (const s of SPORT_INTENTS) {
    if (s.patterns.some((p) => p.test(q))) return s;
  }
  // Bare "college" defaults to college football in season context only when
  // no basketball marker exists; keep it after the specific patterns.
  if (/\bcollege\b/.test(q)) return SPORT_INTENTS[1];
  return null;
}

/** League label from a feed game string: "Duke @ Virginia (CFB)" -> "CFB". */
function pickSportLabel(pick: AskPick): string {
  const m = (pick.game || "").match(/\(([^)]+)\)\s*$/);
  return m ? m[1].toUpperCase() : "";
}

function pickInSport(pick: AskPick, sport: SportIntent): boolean {
  const lbl = pickSportLabel(pick);
  if (!lbl) return false;
  if (sport.feedLabels.includes(lbl)) return true;
  if (sport.label === "soccer" && /LIGA|LEAGUE|SERIE|LIGUE|EPL|MLS|CAMPEONATO/.test(lbl)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Date scope                                                          */
/* ------------------------------------------------------------------ */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

type DateScope = { dates: string[]; word: string; label: string };

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function etDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function addDaysET(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayNameET(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
  });
}

function scopeFromQuestion(q: string): DateScope {
  const today = todayET();
  if (/\btomorrow\b/.test(q)) {
    const d = addDaysET(today, 1);
    return { dates: [d], word: "tomorrow", label: `tomorrow (${weekdayNameET(d)})` };
  }
  if (/\b(weekend|this weekend)\b/.test(q)) {
    // Saturday/Sunday of the current week (ET). If today is Sunday, just today.
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0=Sun
    const sat = addDaysET(today, (6 - dow + 7) % 7);
    const sun = addDaysET(sat, 1);
    const dates = dow === 0 ? [today] : [sat, sun];
    return { dates, word: "this weekend", label: "this weekend" };
  }
  for (const wd of WEEKDAYS) {
    if (new RegExp(`\\b${wd}\\b`).test(q)) {
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
      const target = WEEKDAYS.indexOf(wd);
      const delta = (target - dow + 7) % 7;
      const d = addDaysET(today, delta);
      return { dates: [d], word: wd, label: d === today ? "today" : weekdayNameET(d) };
    }
  }
  return { dates: [today], word: "tonight", label: "tonight" };
}

function isFutureScope(scope: DateScope): boolean {
  return scope.dates[0] > todayET();
}

/* ------------------------------------------------------------------ */
/* Board-only analysis (carried over from the original ask route)      */
/* ------------------------------------------------------------------ */

type Analysis = {
  lean: string;
  confidence: number;
  factors: string[];
  edge: string;
  spreadMove: number;
};

function analyze(game: Game, openings: Record<string, any>): Analysis {
  const factors: string[] = [];
  let lean = "No clear lean";
  let confidence = 1;
  let edge = "No quantified edge from board data alone";

  const open = openings[game.id];
  let spreadMove = 0;

  if (open && game.spread) {
    const openBooks = Object.values(open) as any[];
    if (openBooks.length > 0) {
      const openSpread = (openBooks[0] as any)?.spreads;
      if (openSpread) {
        const homeNick = norm(game.home).split(" ").pop() || "";
        const entry = Object.entries(openSpread).find(([name]) =>
          norm(name as string).includes(homeNick)
        ) as any;
        if (entry?.[1]?.point !== undefined) {
          spreadMove = game.spread.home - entry[1].point;
          if (Math.abs(spreadMove) >= 1) {
            factors.push(
              `Line ${spreadMove > 0 ? "moved toward " + game.away : "moved toward " + game.home} (${Math.abs(spreadMove).toFixed(1)} pts from open)`
            );
          }
        }
      }
    }
  }

  if (game.ml) {
    const { home, away } = game.ml;
    if (home <= -150) {
      lean = `${game.home} ML (${home > 0 ? "+" : ""}${home})`;
      confidence = 2;
      factors.push(`${game.home} priced as a solid favorite`);
      edge = "Favorite ML — modest edge, price-sensitive";
    } else if (away <= -150) {
      lean = `${game.away} ML (${away > 0 ? "+" : ""}${away})`;
      confidence = 2;
      factors.push(`${game.away} priced as a solid favorite`);
      edge = "Favorite ML — modest edge, price-sensitive";
    } else if (home > 0 && away > 0) {
      lean = `${game.home} ML (+${home})`;
      confidence = 1;
      factors.push("Near pick'em — home team gets the nod");
      edge = "Coin-flip game, no quantified edge";
    }
  }

  if (game.spread && Math.abs(spreadMove) >= 1.5) {
    const side = spreadMove > 0 ? game.away : game.home;
    const line = spreadMove > 0 ? game.spread.away : game.spread.home;
    lean = `${side} ${line > 0 ? "+" : ""}${line}`;
    confidence = Math.min(3, confidence + 1);
    factors.push("Steam toward " + side + " suggests sharp interest");
    edge = `~${(Math.abs(spreadMove) * 8).toFixed(0)}¢ estimated from line move`;
  }

  return { lean, confidence: Math.max(1, Math.min(4, confidence)), factors, edge, spreadMove };
}

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

const SPORT_LABEL: Record<string, string> = {
  americanfootball_nfl: "NFL",
  americanfootball_ncaaf: "College football",
  basketball_nba: "NBA",
  basketball_ncaab: "College hoops",
  basketball_wnba: "WNBA",
  icehockey_nhl: "NHL",
  baseball_mlb: "MLB",
};

function sportLabel(key: string): string {
  if (SPORT_LABEL[key]) return SPORT_LABEL[key];
  if (key.startsWith("soccer")) return "Soccer";
  if (key.startsWith("tennis")) return "Tennis";
  if (key.startsWith("mma")) return "MMA";
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function fmtOdds(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtPt(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function timeET(iso: string): string {
  try {
    return (
      new Date(iso).toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
      }) + " ET"
    );
  } catch {
    return "";
  }
}

function dayET(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    });
  } catch {
    return "";
  }
}

const CONF_WORDS: Record<number, string> = {
  1: "barely-there",
  2: "mild",
  3: "decent",
  4: "strong",
  5: "top-tier",
};

function statLine(s: RecordStat): string {
  const base = s.p > 0 ? `${s.w}–${s.l}–${s.p}` : `${s.w}–${s.l}`;
  return s.pct !== null ? `${base} (${s.pct.toFixed(1)}% on decided games)` : base;
}

/** "Lightning ML +112" when the price isn't already in the play string. */
function playWithPrice(p: AskPick): string {
  if (!p.price) return p.play;
  return p.play.includes(p.price) ? p.play : `${p.play} ${p.price}`;
}

/** One compact sentence with the game's headline numbers. */
function linesSentence(g: Game): string {
  const bits: string[] = [];
  if (g.spread) {
    bits.push(
      g.spread.home === 0 && g.spread.away === 0
        ? "the spread is a pick'em"
        : `the spread is ${g.away} ${fmtPt(g.spread.away)} / ${g.home} ${fmtPt(g.spread.home)}`
    );
  }
  if (g.total) bits.push(`the total sits at ${g.total.line}`);
  if (g.ml) bits.push(`moneyline is ${g.away} ${fmtOdds(g.ml.away)} / ${g.home} ${fmtOdds(g.ml.home)}`);
  if (!bits.length) return "I don't have lines posted for it on the board right now.";
  const s = bits.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

function hasStarted(g: Game): boolean {
  return new Date(g.commence).getTime() <= Date.now();
}

/* ------------------------------------------------------------------ */
/* Answer composers                                                    */
/* ------------------------------------------------------------------ */

function describeGame(g: Game, data: AskData): string {
  const cardPick = findCardPick(g, data.card);
  let when: string;
  if (etDateOf(g.commence) === todayET()) {
    if (hasStarted(g)) {
      when = `today at ${timeET(g.commence)} — already underway, so treat these as pregame lines from the last snapshot`;
    } else {
      const hourET = Number(
        new Date(g.commence).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })
      );
      when = `${hourET >= 17 ? "tonight" : "today"} at ${timeET(g.commence)}`;
    }
  } else {
    when = `${dayET(g.commence)} at ${timeET(g.commence)}`;
  }
  const parts: string[] = [
    `${g.away} at ${g.home} — ${sportLabel(g.sport)}, ${when}.`,
    linesSentence(g),
  ];

  if (cardPick) {
    parts.push(
      `That one's actually on today's card: we're on ${playWithPrice(cardPick)}, confidence ${cardPick.confidence} of 5${cardPick.star ? " — it's our ★ play" : ""}.`
    );
    const why = cardPick.reasoning || cardPick.writeup;
    if (why) parts.push(why.split(/(?<=[.!?])\s+/).slice(0, 2).join(" "));
    if (cardPick.edge_cents) parts.push(`The model has it at about a ${cardPick.edge_cents}¢ edge.`);
    parts.push("Full writeup's on the Picks tab.");
    return parts.join(" ");
  }

  const a = analyze(g, data.openings);
  if (Math.abs(a.spreadMove) >= 1 && g.spread) {
    const toward = a.spreadMove > 0 ? g.away : g.home;
    parts.push(
      `The line's moved ${Math.abs(a.spreadMove).toFixed(1)} points toward ${toward} since it opened, so that's where the money's been going.`
    );
  }
  if (a.lean !== "No clear lean") {
    parts.push(
      `If I had to lean, I'd take ${a.lean} — call it a ${CONF_WORDS[a.confidence] || "mild"} read (${a.confidence}/5). That's board-only, though: lines and movement, no injury or matchup deep-dive behind it, and it's not on today's card.`
    );
  } else {
    parts.push(
      "Honestly, I don't have a real lean on this one — the board isn't showing an edge worth pretending about, and it's not on today's card."
    );
  }
  return parts.join(" ");
}

function briefGameLine(g: Game): string {
  let base: string;
  if (g.ml) {
    const fav =
      g.ml.home < g.ml.away
        ? `${g.home} (${fmtOdds(g.ml.home)})`
        : `${g.away} (${fmtOdds(g.ml.away)})`;
    base = `${g.away} at ${g.home} — ${fav} favored`;
  } else if (g.spread) {
    const fav = g.spread.home < 0 ? `${g.home} ${g.spread.home}` : `${g.away} ${g.spread.away}`;
    base = `${g.away} at ${g.home} — ${fav}`;
  } else {
    base = `${g.away} at ${g.home}`;
  }
  if (g.total) base += `, total ${g.total.line}`;
  return base;
}

function answerTotal(g: Game, data: AskData): string {
  if (!g.total)
    return `I don't have a total posted for ${g.away} at ${g.home} on the board right now.`;
  const cardPick = findCardPick(g, data.card);
  let s = `The total for ${g.away} at ${g.home} is ${g.total.line}.`;
  if (cardPick && /over|under/i.test(cardPick.play)) {
    s += ` And that's a live one for us — the card has ${playWithPrice(cardPick)} (confidence ${cardPick.confidence}/5).`;
  } else {
    s += " I don't have a strong over/under lean on it beyond the number — no total play on today's card for this game.";
  }
  return s;
}

function answerSpread(g: Game, data: AskData): string {
  if (!g.spread)
    return `I don't have a spread posted for ${g.away} at ${g.home} on the board right now.`;
  const a = analyze(g, data.openings);
  let s = `Spread for ${g.away} at ${g.home}: ${g.away} ${fmtPt(g.spread.away)}, ${g.home} ${fmtPt(g.spread.home)}.`;
  if (Math.abs(a.spreadMove) >= 1) {
    const toward = a.spreadMove > 0 ? g.away : g.home;
    s += ` It's moved ${Math.abs(a.spreadMove).toFixed(1)} points toward ${toward} since the open.`;
  }
  const cardPick = findCardPick(g, data.card);
  if (cardPick) s += ` The card's play here is ${playWithPrice(cardPick)} (confidence ${cardPick.confidence}/5).`;
  return s;
}

function answerML(g: Game, data: AskData): string {
  if (!g.ml)
    return `I don't have a moneyline posted for ${g.away} at ${g.home} on the board right now.`;
  const favHome = g.ml.home < g.ml.away;
  const fav = favHome ? g.home : g.away;
  const favPrice = favHome ? g.ml.home : g.ml.away;
  const dog = favHome ? g.away : g.home;
  const dogPrice = favHome ? g.ml.away : g.ml.home;
  let s = `${fav} is favored on the moneyline at ${fmtOdds(favPrice)}; ${dog} is ${fmtOdds(dogPrice)}. (${g.away} ${fmtOdds(g.ml.away)} / ${g.home} ${fmtOdds(g.ml.home)}.)`;
  const cardPick = findCardPick(g, data.card);
  if (cardPick) {
    s += ` We're on this game today — ${playWithPrice(cardPick)}, confidence ${cardPick.confidence}/5.`;
  }
  return s;
}

function answerWhy(g: Game, data: AskData): string {
  const cardPick = findCardPick(g, data.card);
  if (cardPick) {
    const why = cardPick.reasoning || cardPick.writeup;
    if (why) return `On ${cardPick.play}: ${why.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ")}`;
    return `The card has ${playWithPrice(cardPick)} (confidence ${cardPick.confidence}/5) — the full reasoning is in the writeup on the Picks tab.`;
  }
  const a = analyze(g, data.openings);
  if (a.lean === "No clear lean")
    return `Honestly there's not much behind a lean here — the board's basically neutral on ${g.away} at ${g.home}, which is why it's not on today's card.`;
  const bits = a.factors.length ? ` What I'm seeing: ${a.factors.join("; ").toLowerCase()}.` : "";
  return `The lean toward ${a.lean} is a board read — ${a.edge.toLowerCase()}.${bits} It's not a card play, just where the lines point.`;
}

function answerConfidence(g: Game, data: AskData): string {
  const cardPick = findCardPick(g, data.card);
  if (cardPick)
    return `${cardPick.play} is a confidence ${cardPick.confidence} of 5 on today's card${cardPick.star ? " — a ★ play, the strongest grade we give" : ""}.`;
  const a = analyze(g, data.openings);
  if (a.lean === "No clear lean")
    return `Low — I don't have a lean on ${g.away} at ${g.home} at all, so call it a 1 of 5. It's not close to the card.`;
  return `I'd put the board lean (${a.lean}) at a ${a.confidence} of 5 — a ${CONF_WORDS[a.confidence]} read. Card plays are the ones we actually stand behind; this isn't one.`;
}

function answerProps(question: string, contextGames: Game[], data: AskData): string {
  const words = norm(question).split(/\s+/).filter((w) => w.length >= 3);
  const teamWords = contextGames.flatMap((g) =>
    [...norm(g.home).split(" "), ...norm(g.away).split(" ")].filter((w) => w.length >= 4)
  );
  const hit = data.props.find((p) => {
    const label = norm(`${p.game} ${p.play}`);
    return (
      words.some((w) => label.includes(w)) || teamWords.some((w) => label.includes(w))
    );
  });
  if (hit) {
    return `From the brief's notable props: ${playWithPrice(hit)} (confidence ${hit.confidence}/5) — that's in ${hit.game}. The full props list lives on the Picks tab.`;
  }
  if (!data.props.length) {
    return "No player props in today's feed — the brief didn't flag any notable props today, and props aren't on my live board (I only see spreads, totals, and moneylines here). If the brief posts props, they'll be on the Picks tab.";
  }
  return "Player props aren't on my live board feed — I only see spreads, totals, and moneylines here. When the brief flags notable props they show up on the Picks tab, but I don't have one matching that in today's feed.";
}

function answerRecord(data: AskData): string {
  const r = data.records;
  if (!r) return "I can't pull the track record right this second — the Record tab has the full, always-current history.";
  const parts: string[] = [`All-time, the card is ${statLine(r.allTime)}.`];
  if (r.showSinceRecal) parts.push(`Since the October 16th recalibration we're ${statLine(r.sinceRecal)} — that's the run the current model is on.`);
  if (r.showStars) parts.push(`The ★ plays are ${statLine(r.stars)}.`);
  if (r.showLast7) parts.push(`Last 7 days: ${statLine(r.last7)}.`);
  parts.push("Every graded pick is on the Record tab if you want the receipts.");
  return parts.join(" ");
}

function answerCard(data: AskData): { reply: string; gameIds: string[] } {
  if (!data.card.length)
    return {
      reply: "Nothing's posted on today's card yet — when the brief drops, the plays land on the Picks tab and I can walk you through them here.",
      gameIds: [],
    };
  const lines = data.card.map(
    (p) => `${p.star ? "★ " : ""}${playWithPrice(p)} · conf ${p.confidence}/5 — ${p.game}${p.starts ? `, ${p.starts}` : ""}`
  );
  let s = `Today's card has ${data.card.length} play${data.card.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
  if (data.teaser) s += `\nTeaser of the day: ${data.teaser.legs.join(" + ")} (${data.teaser.points} pts, conf ${data.teaser.confidence}/5).`;
  else if (data.lookaheadTeaser) s += `\nNo same-day teaser, but this week's lookahead teaser is on the board: ${data.lookaheadTeaser.legs.join(" + ")} (${data.lookaheadTeaser.points} pts, conf ${data.lookaheadTeaser.confidence}/5).`;
  if (data.parlay) s += `\nParlay of the day: ${data.parlay.legs.join(" + ")}${data.parlay.odds ? ` at ${data.parlay.odds}` : ""} (conf ${data.parlay.confidence}/5).`;
  s += "\nAsk me about any of them and I'll give you the reasoning.";
  return { reply: s, gameIds: cardGameIds(data) };
}

function answerStar(data: AskData): string {
  const stars = data.card.filter((p) => p.star);
  if (!stars.length) {
    if (!data.card.length) return "No ★ play today — the card isn't posted yet. Star plays only go up when a pick clears the top bar.";
    const top = [...data.card].sort((a, b) => b.confidence - a.confidence)[0];
    return `No ★ play on today's card — nothing cleared the top bar. The strongest play we do have is ${playWithPrice(top)} (confidence ${top.confidence}/5) in ${top.game}.`;
  }
  const parts = stars.map((p) => {
    let s = `Today's ★ play: ${playWithPrice(p)} — ${p.game}, confidence ${p.confidence} of 5.`;
    const why = p.reasoning || p.writeup;
    if (why) s += ` ${why.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ")}`;
    if (p.edge_cents) s += ` The model has it at about a ${p.edge_cents}¢ edge.`;
    return s;
  });
  return parts.join(" ");
}

function answerTeaser(data: AskData): string {
  if (data.teaser)
    return `Today's teaser: ${data.teaser.legs.join(" + ")} — a ${data.teaser.points}-point teaser at confidence ${data.teaser.confidence}/5. It's on the Picks tab with the full card.`;
  if (data.lookaheadTeaser) {
    const when = data.lookaheadTeaser.target_date
      ? ` It settles on ${weekdayNameET(data.lookaheadTeaser.target_date)}.`
      : "";
    return `No same-day teaser today, but there IS a lookahead teaser posted for the weekend: ${data.lookaheadTeaser.legs.join(" + ")} (${data.lookaheadTeaser.points} pts, confidence ${data.lookaheadTeaser.confidence}/5).${when}`;
  }
  return "No teaser today — nothing met the bar for one. The standing rule is we never force a teaser; if nothing qualifies, the card just goes without.";
}

function answerParlay(data: AskData): string {
  if (data.parlay)
    return `Today's parlay: ${data.parlay.legs.join(" + ")}${data.parlay.odds ? ` at ${data.parlay.odds}` : ""}, confidence ${data.parlay.confidence}/5. Full details on the Picks tab.`;
  return "No parlay today — nothing met the bar. Same rule as the teaser: we never force one, so a thin day just goes without.";
}

function answerFreePick(data: AskData): string {
  if (!data.card.length)
    return "The card isn't posted yet today, so there's no featured play to point at — check the Picks tab once the brief drops.";
  const top = [...data.card].sort(
    (a, b) => b.confidence - a.confidence || (b.edge_cents || 0) - (a.edge_cents || 0)
  )[0];
  return `There's no separate free-pick slot in my feed, but the headline play on today's card is ${top.star ? "★ " : ""}${playWithPrice(top)} (confidence ${top.confidence}/5) in ${top.game}. The full card's on the Picks tab.`;
}

/* ------------------------------------------------------------------ */
/* Slate + sport answers                                               */
/* ------------------------------------------------------------------ */

function gamesInScope(data: AskData, scope: DateScope, sport?: SportIntent): Game[] {
  return data.events
    .map((ev) => extractGame(ev))
    .filter((g) => scope.dates.includes(etDateOf(g.commence)))
    .filter((g) => !sport || sport.matchKey(g.sport))
    .sort((a, b) => new Date(a.commence).getTime() - new Date(b.commence).getTime());
}

function answerSlate(data: AskData, scope: DateScope): { reply: string; gameIds: string[] } {
  const all = gamesInScope(data, scope);
  if (!all.length) {
    // Nothing in scope — point at the next day that has games.
    const future = data.events
      .map((ev) => extractGame(ev))
      .filter((g) => etDateOf(g.commence) > scope.dates[scope.dates.length - 1])
      .sort((a, b) => new Date(a.commence).getTime() - new Date(b.commence).getTime());
    if (future.length) {
      const d = etDateOf(future[0].commence);
      return {
        reply: `Nothing on the board ${scope.label}. Next up is ${weekdayNameET(d)} — ${future.length} game${future.length === 1 ? "" : "s"} starting with ${future[0].away} at ${future[0].home} at ${timeET(future[0].commence)}.`,
        gameIds: future.slice(0, 12).map((g) => g.id),
      };
    }
    return { reply: "The board's empty right now — no games posted. Check back after the next odds refresh.", gameIds: [] };
  }

  const upcoming = isFutureScope(scope) ? all : all.filter((g) => !hasStarted(g));
  const startedCount = all.length - upcoming.length;
  const list = upcoming.length ? upcoming : all;
  const shown = list.slice(0, 12);
  const lines = shown.map((g) => `${timeET(g.commence)} — ${briefGameLine(g)} (${sportLabel(g.sport)})`);
  const more = list.length > shown.length ? `\n…plus ${list.length - shown.length} more.` : "";
  const startedNote =
    startedCount > 0 && upcoming.length
      ? `\n(${startedCount} earlier game${startedCount === 1 ? " has" : "s have"} already tipped off and ${startedCount === 1 ? "isn't" : "aren't"} listed.)`
      : "";
  const header =
    scope.word === "tonight"
      ? upcoming.length
        ? "Here's what's still on the board today"
        : "Everything on today's board has already tipped off — here's the full list"
      : `Here's the board for ${scope.label}`;
  return {
    reply: `${header}:\n${lines.join("\n")}${more}${startedNote}\nWant a read on any of them? Just name the matchup.`,
    gameIds: list.map((g) => g.id),
  };
}

function answerSport(
  sport: SportIntent,
  scope: DateScope,
  wantsValue: boolean,
  data: AskData
): { reply: string; gameIds: string[] } {
  const all = gamesInScope(data, scope, sport);
  const upcoming = isFutureScope(scope) ? all : all.filter((g) => !hasStarted(g));
  const startedCount = all.length - upcoming.length;
  // If everything already started, still list the games (marked) — never
  // return an empty slate.
  const list = upcoming.length ? upcoming : all;
  const allStarted = upcoming.length === 0 && all.length > 0;

  // Card picks in this sport — only meaningful for today's card.
  const cardPicks = scope.dates.includes(todayET())
    ? data.card.filter((p) => pickInSport(p, sport))
    : [];
  const teaserHit =
    scope.dates.includes(todayET()) && data.lookaheadTeaser
      ? data.lookaheadTeaser.legs.some((leg) =>
          data.events.some((ev) => {
            const g = extractGame(ev);
            return sport.matchKey(g.sport) && norm(leg).includes(norm(g.home).split(" ").pop() || "\0");
          })
        )
      : false;

  if (!all.length && !cardPicks.length) {
    // No games in scope — say so plainly and point at the next date with games.
    const future = data.events
      .map((ev) => extractGame(ev))
      .filter((g) => sport.matchKey(g.sport))
      .sort((a, b) => new Date(a.commence).getTime() - new Date(b.commence).getTime());
    const next = future.find((g) => etDateOf(g.commence) > scope.dates[scope.dates.length - 1]);
    let s = `No ${sport.label} on the board ${scope.label}.`;
    if (next) {
      const d = etDateOf(next.commence);
      const n = future.filter((g) => etDateOf(g.commence) === d).length;
      s += ` The next ${sport.label} slate is ${weekdayNameET(d)} — ${n} game${n === 1 ? "" : "s"}. Ask me about ${weekdayNameET(d)} and I'll walk you through it.`;
    }
    return { reply: s, gameIds: [] };
  }

  const parts: string[] = [];

  if (cardPicks.length) {
    const lead = cardPicks
      .map((p) => {
        let s = `${p.star ? "★ " : ""}${playWithPrice(p)} (confidence ${p.confidence}/5) in ${p.game}`;
        const why = p.reasoning || p.writeup;
        if (why) s += ` — ${why.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ")}`;
        if (p.edge_cents) s += ` The model sees about a ${p.edge_cents}¢ edge.`;
        return s;
      })
      .join(" ");
    parts.push(
      `${wantsValue ? "Yes — we're on it" : "Our card has it covered"}: ${lead}`
    );
  }

  if (list.length) {
    const shown = list.slice(0, 14);
    const lines = shown.map((g) => {
      let line = `${timeET(g.commence)} — ${briefGameLine(g)}`;
      const onCard = findCardPick(g, data.card);
      if (onCard) line += ` ← our play: ${playWithPrice(onCard)}`;
      else {
        const a = analyze(g, data.openings);
        if (Math.abs(a.spreadMove) >= 1.5 && a.lean !== "No clear lean")
          line += ` (board lean from line movement: ${a.lean} — lines only, not a card play)`;
      }
      return line;
    });
    const more = list.length > shown.length ? `\n…plus ${list.length - shown.length} more.` : "";
    const startedNote = allStarted
      ? ` (all already kicked off — these are the pregame lines from the last snapshot.)`
      : startedCount > 0
        ? ` (${startedCount} already tipped off earlier and not listed.)`
        : "";
    parts.push(
      `${sport.label === "soccer" ? "Soccer" : titleCase(sport.label)} ${scope.word === "tonight" ? "tonight" : scope.label}:${startedNote}\n${lines.join("\n")}${more}`
    );
  }

  if (!cardPicks.length && list.length && wantsValue && !isFutureScope(scope)) {
    parts.push(
      "Honest answer on value: nothing in this sport made today's card and the board isn't flashing a steam edge I'd dress up as one — so no play from us here, just the lines above."
    );
  }
  if (!cardPicks.length && list.length && wantsValue && isFutureScope(scope)) {
    parts.push(
      "On value: the card for that day isn't posted yet — plays drop with that morning's brief. The lines above are what's up so far."
    );
  }
  if (!list.length && cardPicks.length) {
    parts.push("That game's already underway or done, so it's off the live list above — the pick above is what we published pregame.");
  }
  if (teaserHit && data.lookaheadTeaser) {
    parts.push(
      `Also relevant: this week's lookahead teaser includes a ${sport.label} leg — ${data.lookaheadTeaser.legs.join(" + ")} (${data.lookaheadTeaser.points} pts, conf ${data.lookaheadTeaser.confidence}/5).`
    );
  }

  const ids = [...new Set([...list.map((g) => g.id), ...cardGameIds(data)])];
  return { reply: parts.join("\n\n"), gameIds: ids };
}

/* ------------------------------------------------------------------ */
/* Context resolution                                                  */
/* ------------------------------------------------------------------ */

/** Game ids from the most recent assistant turn that referenced games. */
function lastContextIds(history: ChatTurn[]): string[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i];
    if (t.role === "assistant" && t.gameIds && t.gameIds.length) return t.gameIds;
  }
  return [];
}

const ORDINALS: Record<string, number> = {
  first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5, seventh: 6, eighth: 7, ninth: 8, tenth: 9,
  "1st": 0, "2nd": 1, "3rd": 2, "4th": 3, "5th": 4,
};

function resolveContextGame(question: string, history: ChatTurn[], data: AskData): Game | null {
  const ids = lastContextIds(history);
  if (!ids.length) return null;
  const q = norm(question);
  const games = ids.map((id) => gameById(id, data.events)).filter(Boolean) as Game[];
  if (!games.length) return null;

  if (/\b(late|last|latest|final)\b/.test(q)) return games[games.length - 1];
  if (/\b(first|early|earliest|opener|opening)\b/.test(q)) return games[0];
  for (const [word, idx] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(q) && games[idx]) return games[idx];
  }
  // Sport reference into a multi-game context ("the NBA one")
  const sportHit = games.find((g) => q.includes(norm(sportLabel(g.sport))) || q.includes(g.sport.split("_").pop() || "\0"));
  if (sportHit && games.length > 1) return sportHit;

  return games[0];
}

/** What aspect of a game is the user asking about? */
function subIntent(q: string): "total" | "spread" | "ml" | "why" | "confidence" | "props" | "full" {
  if (/\bprop|player|rebounds|assists|yards|receptions|strikeouts|threes\b/.test(q)) return "props";
  if (/\btotal|over|under|o\/u\b/.test(q)) return "total";
  if (/\bspread|cover|line move|steam\b/.test(q)) return "spread";
  if (/\bmoneyline|money line|\bml\b|favored|favourite|favorite|who wins|who do you like|winner\b/.test(q)) return "ml";
  if (/\bwhy|reason|reasoning\b/.test(q)) return "why";
  if (/\bconfidence|how confident|sure\b/.test(q)) return "confidence";
  return "full";
}

function answerAboutGame(g: Game, intent: ReturnType<typeof subIntent>, question: string, data: AskData): string {
  switch (intent) {
    case "total": return answerTotal(g, data);
    case "spread": return answerSpread(g, data);
    case "ml": return answerML(g, data);
    case "why": return answerWhy(g, data);
    case "confidence": return answerConfidence(g, data);
    case "props": return answerProps(question, [g], data);
    default: return describeGame(g, data);
  }
}

const VALUE_PHRASE = /\bvalue|best bets?|what'?s good|anything good|good bets?|plays?\b.*\b(tonight|today|sunday|weekend)\b|\bbets?\b/;

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

export function answerQuestion(
  question: string,
  history: ChatTurn[],
  data: AskData
): { reply: string; gameIds: string[] } {
  const raw = question.trim();
  const q = norm(raw);

  // Small talk
  if (/^(hi|hey|hello|yo|sup|morning|afternoon|evening)\b/.test(q) && q.split(/\s+/).length <= 4) {
    return {
      reply: "Hey! I can walk you through tonight's board, today's card, any matchup's lines and leans, or how the record's looking. What do you want to dig into?",
      gameIds: [],
    };
  }
  if (/^(thanks|thank you|thx|ty)\b/.test(q)) {
    return { reply: "Anytime. Holler if you want a read on another game.", gameIds: [] };
  }

  // Futures / championships — not a market the board carries.
  if (/\bsuper bowl\b|\bwin it all\b|\bchampionship\b.*\bwinner\b|\bworld series winner\b/.test(q)) {
    return {
      reply: "I only track game lines on the board — spreads, totals, and moneylines for scheduled games. Futures like Super Bowl or championship winners aren't on it, so I won't guess at one. Ask me about a game or a slate and I'll give you the real numbers.",
      gameIds: [],
    };
  }

  // Tomorrow's picks don't exist yet — never dress today's card up as them.
  // (norm() strips the apostrophe, so "tomorrow's" arrives as "tomorrows".)
  if (/\btomorrows?\b/.test(q) && /\bpicks|card|plays|bets\b/.test(q)) {
    return {
      reply: "Tomorrow's card isn't posted yet — picks drop with the morning brief, and I won't pretend today's card is tomorrow's. If you want, ask me about tomorrow's slate and I'll walk you through the games and lines that are already up.",
      gameIds: [],
    };
  }

  // Track record first when the question is about performance ("how are
  // the star plays doing") — the star-play branch below is for today's play.
  const namedGames = findGames(raw, data.events);
  const recordAsk =
    /\brecord\b|\btrack record\b|\bwin rate\b|how (are|have) you (doing|been)|how are we doing|how'?d you do|how did you do|star plays? (doing|been|record)|how'?s the (week|month)\b/.test(q);
  if (recordAsk && !namedGames.length) {
    return { reply: answerRecord(data), gameIds: [] };
  }

  // Card sub-questions (checked before team matching: "card" used to
  // false-match "Cardinals", "star" questions hit the fallback, etc.)
  if (/\bstar (play|pick)|★|star of the day\b/.test(q)) {
    return { reply: answerStar(data), gameIds: cardGameIds(data) };
  }
  if (/\bteaser\b/.test(q)) {
    return { reply: answerTeaser(data), gameIds: [] };
  }
  if (/\bparlay\b/.test(q)) {
    return { reply: answerParlay(data), gameIds: [] };
  }
  if (/\bfree pick\b/.test(q)) {
    return { reply: answerFreePick(data), gameIds: cardGameIds(data) };
  }

  // Today's card / best bets
  const cardAsk =
    /\b(today'?s|the) card\b|\bon the card\b|\byour picks\b|\bwhat are you on\b|\bplays today\b|\bcard today\b|\bbest bets?\b/.test(q);
  if (cardAsk && !namedGames.length) {
    return answerCard(data);
  }

  // Sport-scoped questions (slate or value) — before team matching so
  // "college football" can't be hijacked by a team literally named College.
  const sport = detectSport(q);
  if (sport) {
    const scope = scopeFromQuestion(q);
    const slatey = /\bwhat|games|on\b|tonight|today|tomorrow|weekend|sunday|monday|tuesday|wednesday|thursday|friday|saturday|slate|schedule\b/.test(q);
    if (!namedGames.length || VALUE_PHRASE.test(q) || slatey) {
      return answerSport(sport, scope, VALUE_PHRASE.test(q) || /\b(best|good|value)\b/.test(q), data);
    }
  }

  // Known pro team referenced by name — resolve it directly, or answer
  // honestly when that team simply isn't on the board (Bruins, Yankees…).
  const kt = knownTeamRef(q);
  if (kt) {
    const g = gameForTeam(kt, data.events);
    if (g) {
      return { reply: answerAboutGame(g, subIntent(q), raw, data), gameIds: [g.id] };
    }
    return {
      reply: `The ${titleCase(kt.name)} aren't on the board — no ${titleCase(kt.nick)} game in the current slate. I won't guess at lines for a game that isn't posted. Ask me what's on tonight, or name a team that is playing, and I'll give you the real numbers.`,
      gameIds: [],
    };
  }

  // Team(s) named directly — a fresh matchup question wins over context.
  if (namedGames.length) {
    const intent = subIntent(q);
    const primary = namedGames[0];
    if (namedGames.length === 1 || intent !== "full") {
      let reply = answerAboutGame(primary, intent, raw, data);
      if (namedGames.length > 1) {
        const others = namedGames
          .slice(1)
          .map((g) => `${g.away} at ${g.home} (${sportLabel(g.sport)}, ${dayET(g.commence)} ${timeET(g.commence)})`)
          .join("; ");
        reply += `\n\nThere's also: ${others} — if you meant one of those, say the word.`;
      }
      return { reply, gameIds: namedGames.map((g) => g.id) };
    }
    const parts = [describeGame(primary, data)];
    for (const g of namedGames.slice(1)) {
      parts.push(`Also on the board: ${briefGameLine(g)}, ${timeET(g.commence)}. Want me to dig into that one too?`);
    }
    return { reply: parts.join("\n\n"), gameIds: namedGames.map((g) => g.id) };
  }

  // Date-scoped slate ("what games are on tomorrow?", "this weekend?")
  const scope = scopeFromQuestion(q);
  if (
    /\bwhat games|games (on|tonight|today)|tonight'?s (games|board|slate)|the board|slate|schedule|what'?s on|anything (on|good)\b/.test(q) ||
    isFutureScope(scope)
  ) {
    return answerSlate(data, scope);
  }

  // Props with no named team — resolve against context if possible.
  if (subIntent(q) === "props") {
    const ctx = resolveContextGame(raw, history, data);
    return { reply: answerProps(raw, ctx ? [ctx] : [], data), gameIds: ctx ? [ctx.id] : [] };
  }

  // Follow-up against the conversation's game(s).
  const ctx = resolveContextGame(raw, history, data);
  if (ctx) {
    return { reply: answerAboutGame(ctx, subIntent(q), raw, data), gameIds: [ctx.id] };
  }

  return {
    reply:
      "I couldn't find that on the board. Give me a team or a matchup — like “Celtics” or “Chiefs vs Chargers” — or ask me what's on tonight, a sport (\"any CFB value?\"), what's on today's card, or how the record's looking.",
    gameIds: [],
  };
}
