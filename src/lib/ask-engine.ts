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
/* Team matching (carried over from the original ask route)            */
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
 * hits, so "and" matched "Orl**and**o" and conversational follow-ups ("who is
 * favored in the late one?") false-matched random games. Stopwords are
 * stripped, and matching is word-based: exact team word, team-word prefix
 * (4+ letters), or substring only for 5+ letter words ("wolves" in
 * "timberwolves"). Short team tokens survive via the alias table (kc → kansas
 * city, bos → celtics) or exact team-word equality ("sox", "heat").
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
  "other", "another", "just", "really",
]);

export function findGames(question: string, events: any[]): Game[] {
  const q = expandAliases(question);
  const words = q
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const matches: { ev: any; score: number }[] = [];

  for (const ev of events) {
    const home = norm(ev.home_team || "");
    const away = norm(ev.away_team || "");
    const teamWords = [...home.split(" "), ...away.split(" ")];
    let score = 0;
    for (const w of words) {
      if (teamWords.includes(w)) score += 3;
      else if (w.length >= 4 && teamWords.some((tw) => tw.startsWith(w))) score += 2;
      else if (w.length >= 5 && (home.includes(w) || away.includes(w))) score += 2;
    }
    if (score >= 2) matches.push({ ev, score });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 3).map(({ ev }) => extractGame(ev));
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

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function etDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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

/* ------------------------------------------------------------------ */
/* Answer composers                                                    */
/* ------------------------------------------------------------------ */

function describeGame(g: Game, data: AskData): string {
  const cardPick = findCardPick(g, data.card);
  let when: string;
  if (etDateOf(g.commence) === todayET()) {
    const hourET = Number(
      new Date(g.commence).toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })
    );
    when = `${hourET >= 17 ? "tonight" : "today"} at ${timeET(g.commence)}`;
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
  if (g.ml) {
    const fav =
      g.ml.home < g.ml.away
        ? `${g.home} (${fmtOdds(g.ml.home)})`
        : `${g.away} (${fmtOdds(g.ml.away)})`;
    return `${g.away} at ${g.home} — ${fav} favored`;
  }
  if (g.spread) {
    const fav = g.spread.home < 0 ? `${g.home} ${g.spread.home}` : `${g.away} ${g.spread.away}`;
    return `${g.away} at ${g.home} — ${fav}`;
  }
  return `${g.away} at ${g.home}`;
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

function answerCard(data: AskData): string {
  if (!data.card.length)
    return "Nothing's posted on today's card yet — when the brief drops, the plays land on the Picks tab and I can walk you through them here.";
  const lines = data.card.map(
    (p) => `${p.star ? "★ " : ""}${playWithPrice(p)} · conf ${p.confidence}/5 — ${p.game}${p.starts ? `, ${p.starts}` : ""}`
  );
  let s = `Today's card has ${data.card.length} play${data.card.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
  if (data.teaser) s += `\nTeaser of the day: ${data.teaser.legs.join(" + ")} (${data.teaser.points} pts, conf ${data.teaser.confidence}/5).`;
  if (data.parlay) s += `\nParlay of the day: ${data.parlay.legs.join(" + ")}${data.parlay.odds ? ` at ${data.parlay.odds}` : ""} (conf ${data.parlay.confidence}/5).`;
  s += "\nAsk me about any of them and I'll give you the reasoning.";
  return s;
}

function slateGames(data: AskData): Game[] {
  const today = todayET();
  const all = data.events
    .map((ev) => extractGame(ev))
    .sort((a, b) => new Date(a.commence).getTime() - new Date(b.commence).getTime());
  const todays = all.filter((g) => etDateOf(g.commence) === today);
  return todays.length ? todays : all.slice(0, 8);
}

function answerSlate(data: AskData): { reply: string; gameIds: string[] } {
  const games = slateGames(data);
  if (!games.length)
    return { reply: "The board's empty right now — no games posted. Check back after the next odds refresh.", gameIds: [] };
  const isToday = etDateOf(games[0].commence) === todayET();
  const shown = games.slice(0, 10);
  const lines = shown.map(
    (g) => `${timeET(g.commence)} — ${briefGameLine(g)} (${sportLabel(g.sport)})`
  );
  const more = games.length > shown.length ? `\n…plus ${games.length - shown.length} more.` : "";
  return {
    reply: `${isToday ? "Here's what's on the board today" : "Nothing left today — here's the next slate up"}:\n${lines.join("\n")}${more}\nWant a read on any of them? Just name the matchup.`,
    gameIds: shown.map((g) => g.id),
  };
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

  // Track record
  if (/\brecord|how (are|have) you (doing|been)|win rate|track record|your picks doing\b/.test(q) && !findGames(raw, data.events).length) {
    return { reply: answerRecord(data), gameIds: [] };
  }

  // Today's card
  if (/\b(today'?s|the) card|on the card|your picks|what are you on|plays today|card today\b/.test(q) && !findGames(raw, data.events).length) {
    return { reply: answerCard(data), gameIds: [] };
  }

  // Team(s) named directly — a fresh matchup question wins over context.
  const named = findGames(raw, data.events);
  if (named.length) {
    const intent = subIntent(q);
    if (named.length === 1) {
      return { reply: answerAboutGame(named[0], intent, raw, data), gameIds: [named[0].id] };
    }
    const parts = [describeGame(named[0], data)];
    for (const g of named.slice(1)) {
      parts.push(`Also on the board: ${briefGameLine(g)}, ${timeET(g.commence)}. Want me to dig into that one too?`);
    }
    return { reply: parts.join("\n\n"), gameIds: named.map((g) => g.id) };
  }

  // Slate questions ("what games are on tonight?")
  if (/\bwhat games|games (on|tonight|today)|tonight'?s (games|board|slate)|the board|slate|schedule|what'?s on\b/.test(q)) {
    return answerSlate(data);
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
      "I couldn't find that on the board. Give me a team or a matchup — like “Celtics” or “Chiefs vs Chargers” — or ask me what's on tonight, what's on today's card, or how the record's looking.",
    gameIds: [],
  };
}
