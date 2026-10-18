import { NextRequest, NextResponse } from "next/server";
import { getOdds, getOpenings } from "@/lib/odds";

type Game = {
  id: string;
  sport: string;
  home: string;
  away: string;
  commence: string;
  spread?: { home: number; away: number; bestHome: number; bestAway: number };
  total?: { line: number; over: number; under: number };
  ml?: { home: number; away: number };
  steam?: string[];
};

/** Normalize for fuzzy matching */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

/** Find games matching team name fragments in the question */
function findGames(question: string, events: any[]): Game[] {
  const q = norm(question);
  const words = q.split(/\s+/).filter((w) => w.length >= 3);
  const matches: { ev: any; score: number }[] = [];

  for (const ev of events) {
    const home = norm(ev.home_team || "");
    const away = norm(ev.away_team || "");
    let score = 0;
    for (const w of words) {
      if (home.includes(w)) score += 2;
      if (away.includes(w)) score += 2;
      // partial: word is a prefix of a team word
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
    steam: [],
  };

  // Collect best prices across books
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
  const best = (arr: number[]) => (arr.length ? Math.max(...arr) : undefined);

  const homeSpread = mode(spreads.home);
  const awaySpread = mode(spreads.away);
  if (homeSpread !== undefined && awaySpread !== undefined) {
    game.spread = {
      home: homeSpread,
      away: awaySpread,
      bestHome: best(spreads.home.filter((p) => p === homeSpread)) || homeSpread,
      bestAway: best(spreads.away.filter((p) => p === awaySpread)) || awaySpread,
    };
  }

  const totalLine = mode(totals);
  if (totalLine !== undefined) game.total = { line: totalLine, over: -110, under: -110 };

  const homeMl = best(mls.home);
  const awayMl = best(mls.away);
  if (homeMl !== undefined && awayMl !== undefined) {
    game.ml = { home: homeMl, away: awayMl };
  }

  return game;
}

/** Apply the algo framework to generate a lean */
function analyze(game: Game, openings: Record<string, any>): {
  lean: string;
  confidence: number;
  factors: string[];
  edge: string;
  caveat: string;
} {
  const factors: string[] = [];
  let lean = "No clear lean";
  let confidence = 1;
  let edge = "No quantified edge from board data alone";

  const open = openings[game.id];
  let spreadMove = 0;
  let totalMove = 0;

  if (open && game.spread) {
    // Compare current home spread to opening (first book's first market)
    const openBooks = Object.values(open) as any[];
    if (openBooks.length > 0) {
      const firstBook = openBooks[0] as any;
      const openSpread = firstBook?.spreads;
      if (openSpread) {
        const openHome = Object.entries(openSpread).find(
          ([name]) => norm(name as string).includes(norm(game.home).split(" ").pop() || "")
        ) as any;
        if (openHome?.[1]?.point !== undefined) {
          spreadMove = game.spread.home - openHome[1].point;
          if (Math.abs(spreadMove) >= 1) {
            factors.push(
              `Line ${spreadMove > 0 ? "moved toward " + game.away : "moved toward " + game.home} (${Math.abs(spreadMove).toFixed(1)} pts from open)`
            );
          }
        }
      }
    }
  }

  // ML-based lean: significant favorite
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
      // Pick'em-ish: slight lean to home
      lean = `${game.home} ML (${home > 0 ? "+" : ""}${home})`;
      confidence = 1;
      factors.push("Near pick'em — home team gets the nod");
      edge = "Coin-flip game, no quantified edge";
    }
  }

  // Spread lean if line moved significantly
  if (game.spread && Math.abs(spreadMove) >= 1.5) {
    const side = spreadMove > 0 ? game.away : game.home;
    const line = spreadMove > 0 ? game.spread.away : game.spread.home;
    lean = `${side} ${line > 0 ? "+" : ""}${line}`;
    confidence = Math.min(3, confidence + 1);
    factors.push("Steam toward " + side + " suggests sharp interest");
    edge = `~${(Math.abs(spreadMove) * 8).toFixed(0)}¢ estimated from line move`;
  }

  // Total lean placeholder
  if (game.total) {
    factors.push(`Total sitting at ${game.total.line}`);
  }

  const caveat =
    "Board-only read — no injury, weather, or matchup deep-dive. " +
    "For the full breakdown with confirmed drivers, ask for a deep dive.";

  return { lean, confidence: Math.max(1, Math.min(4, confidence)), factors, edge, caveat };
}

export async function POST(req: NextRequest) {
  try {
    const { question } = await req.json();
    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return NextResponse.json({ error: "Ask me about a team or matchup." }, { status: 400 });
    }

    const { events } = await getOdds();
    if (!events || events.length === 0) {
      return NextResponse.json({
        error: "Odds board is empty right now — try again after the next refresh.",
      }, { status: 503 });
    }

    const games = findGames(question, events);
    if (games.length === 0) {
      return NextResponse.json({
        error: "Couldn't find that matchup on the board. Try the full team name — e.g. 'Chiefs vs Chargers'.",
        suggestion: true,
      }, { status: 404 });
    }

    const openings = await getOpenings();
    const analyses = games.map((g) => ({
      game: {
        away: g.away,
        home: g.home,
        sport: g.sport,
        commence: g.commence,
        spread: g.spread,
        total: g.total,
        ml: g.ml,
      },
      ...analyze(g, openings),
    }));

    return NextResponse.json({ analyses });
  } catch (e: any) {
    return NextResponse.json({ error: "Something broke on our end — try again." }, { status: 500 });
  }
}
