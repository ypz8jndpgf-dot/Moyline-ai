import { NextRequest, NextResponse } from "next/server";
import { getOddsCached, getOpenings } from "@/lib/odds";
import { getPicksFeed } from "@/lib/picks";

type Game = {
  id: string;
  sport: string;
  home: string;
  away: string;
  commence: string;
  spread?: { home: number; away: number };
  total?: { line: number };
  ml?: { home: number; away: number };
};

/** Team aliases: nicknames, abbreviations, common typos -> canonical fragment */
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

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

/** Expand aliases in the question */
function expandAliases(question: string): string {
  let q = norm(question);
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    const re = new RegExp(`\\b${alias}\\b`, "g");
    q = q.replace(re, canonical);
  }
  return q;
}

/** Find games matching team name fragments */
function findGames(question: string, events: any[]): Game[] {
  const q = expandAliases(question);
  const words = q.split(/\s+/).filter((w) => w.length >= 3);
  const matches: { ev: any; score: number }[] = [];

  for (const ev of events) {
    const home = norm(ev.home_team || "");
    const away = norm(ev.away_team || "");
    let score = 0;
    for (const w of words) {
      if (home.includes(w)) score += 2;
      if (away.includes(w)) score += 2;
      for (const tw of [...home.split(" "), ...away.split(" ")]) {
        if (tw.startsWith(w) && w.length >= 4) score += 1;
      }
    }
    if (score >= 2) matches.push({ ev, score });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 3).map(({ ev }) => extractGame(ev));
}

function extractGame(ev: any): Game {
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

/** Check if this game is on today's card */
function findCardPick(game: Game, card: any[]): any | null {
  if (!card || card.length === 0) return null;
  const gh = norm(game.home);
  const ga = norm(game.away);
  for (const pick of card) {
    const label = norm(pick.game || pick.label || "");
    // Both teams mentioned in the pick label
    const homeWords = gh.split(" ").filter((w) => w.length >= 4);
    const awayWords = ga.split(" ").filter((w) => w.length >= 4);
    const homeHit = homeWords.some((w) => label.includes(w));
    const awayHit = awayWords.some((w) => label.includes(w));
    if (homeHit && awayHit) return pick;
    // Or single strong match (nickname)
    if (homeWords.length > 0 && label.includes(homeWords[homeWords.length - 1]) && label.includes(awayWords[awayWords.length - 1] || "")) return pick;
  }
  return null;
}

function analyze(game: Game, openings: Record<string, any>, cardPick: any | null): {
  lean: string;
  confidence: number;
  factors: string[];
  edge: string;
  caveat: string;
  onCard?: { play: string; confidence: number; edge?: string };
} {
  // If it's on today's card, lead with the official pick
  if (cardPick) {
    return {
      lean: cardPick.play || cardPick.pick || "On today's card",
      confidence: cardPick.confidence || 3,
      factors: [
        `This is our official ${cardPick.confidence ? `conf-${cardPick.confidence}` : ""} play today`.trim(),
        ...(cardPick.factors || cardPick.keyFactors || []).slice(0, 3),
      ],
      edge: cardPick.edge || cardPick.edge_cents ? `${cardPick.edge_cents}¢ quantified edge` : "See today's card for full reasoning",
      caveat: "This is our published pick — full writeup on the Picks tab.",
      onCard: {
        play: cardPick.play || cardPick.pick,
        confidence: cardPick.confidence || 3,
      },
    };
  }

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
        const entry = Object.entries(openSpread).find(
          ([name]) => norm(name as string).includes(homeNick)
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

  if (game.total) factors.push(`Total sitting at ${game.total.line}`);

  return {
    lean,
    confidence: Math.max(1, Math.min(4, confidence)),
    factors,
    edge,
    caveat: "Board-only read from cached lines — no injury, weather, or matchup deep-dive.",
  };
}

export async function POST(req: NextRequest) {
  try {
    const { question, contextGameId } = await req.json();
    if (!question || typeof question !== "string" || question.trim().length < 3) {
      // Follow-up without a new question: reuse context
      if (!contextGameId) {
        return NextResponse.json({ error: "Ask me about a team or matchup." }, { status: 400 });
      }
    }

    // Cache-only: zero API credits per question (user approved stale data)
    const { events, fetchedAt } = await getOddsCached();
    if (!events || events.length === 0) {
      return NextResponse.json({
        error: "Odds board is empty right now — try again after the next refresh.",
      }, { status: 503 });
    }

    const staleMins = fetchedAt ? Math.round((Date.now() - fetchedAt) / 60000) : null;

    let games: Game[];
    if (contextGameId && (!question || question.trim().length < 3)) {
      // Follow-up: find the context game directly
      const ev = events.find((e: any) => e.id === contextGameId);
      if (!ev) {
        return NextResponse.json({ error: "Lost track of that game — ask again with the matchup." }, { status: 404 });
      }
      games = [extractGame(ev)];
    } else {
      games = findGames(question, events);
      if (games.length === 0) {
        return NextResponse.json({
          error: "Couldn't find that matchup on the board. Try the full team name — e.g. 'Chiefs vs Chargers'.",
          suggestion: true,
        }, { status: 404 });
      }
    }

    const openings = await getOpenings();
    const feed = await getPicksFeed().catch(() => null);
    const card = feed?.picks || [];

    const analyses = games.map((g) => {
      const cardPick = findCardPick(g, card);
      return {
        game: {
          id: g.id,
          away: g.away,
          home: g.home,
          sport: g.sport,
          commence: g.commence,
          spread: g.spread,
          total: g.total,
          ml: g.ml,
        },
        ...analyze(g, openings, cardPick),
      };
    });

    return NextResponse.json({
      analyses,
      meta: {
        staleMins,
        cached: true,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: "Something broke on our end — try again." }, { status: 500 });
  }
}
