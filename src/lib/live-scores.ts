/**
 * Live scores for card picks (optimization #28, built 2026-10-31): today's
 * ESPN scoreboards for the sports on the card, normalized into name-variant
 * lists the client matches pick game strings against. Server-cached in
 * Redis for 45s so member traffic never hammers ESPN. Scores only — the
 * official result still comes from the morning grader.
 */

import { Redis } from "@upstash/redis";
import { getPicksFeed, sportFromGame, type FeedPick } from "@/lib/picks";
import { parseProp, getEventBox, statValue, type EventBox } from "@/lib/cheatsheet";

/** One feed prop settled against the final box score (optimization #67):
 *  the player's actual stat value beside the parsed direction + line, so
 *  the client marker is a bare comparison — all parsing stays server-side
 *  on the Cheatsheet engine's own rules. */
export interface PropResult {
  play: string; // feed play text, verbatim — the client matches on it
  direction: "over" | "under";
  line: number;
  value: number; // the player's actual stat in the final box score
}

export interface LiveGame {
  id: string; // ESPN event id
  sport: string;
  away: string[]; // name variants: display, short, abbreviation
  home: string[];
  awayScore: string;
  homeScore: string;
  state: "pre" | "in" | "post";
  detail: string; // e.g. "Q3 - 4:12", "Final"
  /** Settled feed props for this game (final games only, #67). */
  propResults?: PropResult[];
}

const SCORE_PATH: Record<string, string> = {
  NFL: "football/nfl",
  NBA: "basketball/nba",
  NHL: "hockey/nhl",
  CFB: "football/college-football",
  WNBA: "basketball/wnba",
  MLB: "baseball/mlb",
  MLS: "soccer/usa.1",
};

function redisClient(): Redis | null {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/* ---------------- prop settling helpers (#67) ----------------
 * Local copies of the name matchers LiveScore.tsx uses client-side —
 * the codebase's convention is one small copy per file rather than a
 * shared client/server util. */

const BOX_SPORTS = new Set(["NFL", "NBA", "NHL"]);

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function teamHit(token: string, variants: string[]): boolean {
  const t = normName(token);
  if (!t) return false;
  return variants.some((v) => {
    const n = normName(v);
    return (
      n === t ||
      n.endsWith(" " + t) ||
      t.endsWith(" " + n) ||
      (t.length >= 4 && n.includes(t)) ||
      (n.length >= 4 && t.includes(n))
    );
  });
}

function gameMatches(gameStr: string, g: LiveGame): boolean {
  const clean = (gameStr || "").split("(")[0];
  const parts = clean.split(/\s+@\s+|\s+vs\.?\s+/i);
  if (parts.length !== 2) return false;
  const away = parts[0].trim();
  const home = parts[1].trim();
  return (
    (teamHit(away, g.away) && teamHit(home, g.home)) ||
    ((teamHit(away, g.away) || teamHit(away, g.home)) &&
      (teamHit(home, g.away) || teamHit(home, g.home)))
  );
}

/** The one box-score player a prop query names, or null when the name
 *  matches nobody — or more than one player (same last name on both
 *  rosters settles nothing rather than guessing). Exported for the
 *  logic harness. A short all-letter query ("SGA") also matches on
 *  initials, the way the brief writes star nicknames. */
export function matchPlayer(
  players: EventBox["players"],
  query: string
): { name: string; stats: Record<string, number> } | null {
  const q = normName(query);
  if (!q) return null;
  const initials = (name: string) =>
    normName(name)
      .split(" ")
      .map((w) => w[0])
      .join("");
  const hits = Object.values(players).filter((pl) => {
    const n = normName(pl.name);
    if (n === q || n.endsWith(" " + q) || q.endsWith(" " + n)) return true;
    return /^[a-z]{2,4}$/.test(q) && initials(pl.name) === q;
  });
  return hits.length === 1 ? hits[0] : null;
}

async function fetchJson(url: string): Promise<any> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function getLiveScores(): Promise<LiveGame[]> {
  const key = "moyline:livescores:v1";
  const redis = redisClient();
  if (redis) {
    try {
      const cached = await redis.get<LiveGame[]>(key);
      if (cached) return cached;
    } catch {
      /* fall through to a live fetch */
    }
  }

  const sports = new Set<string>(["NFL", "NBA", "NHL", "CFB", "WNBA"]);
  const feed = await getPicksFeed();
  if (feed) {
    for (const p of [...(feed.picks || []), ...(feed.props || [])]) {
      const s = sportFromGame(p.game);
      if (SCORE_PATH[s]) sports.add(s);
    }
  }

  const dateDash = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  const dateET = dateDash.replace(/-/g, "");
  const games: LiveGame[] = [];
  await Promise.all(
    [...sports].map(async (sport) => {
      const d = await fetchJson(
        `https://site.api.espn.com/apis/site/v2/sports/${SCORE_PATH[sport]}/scoreboard?dates=${dateET}`
      );
      for (const ev of d?.events || []) {
        const comp = ev?.competitions?.[0];
        if (!comp?.competitors) continue;
        const home = comp.competitors.find((c: any) => c.homeAway === "home");
        const away = comp.competitors.find((c: any) => c.homeAway === "away");
        if (!home || !away) continue;
        const names = (c: any) =>
          [c.team?.displayName, c.team?.shortDisplayName, c.team?.abbreviation].filter(Boolean);
        games.push({
          id: String(ev.id || ""),
          sport,
          away: names(away),
          home: names(home),
          awayScore: String(away.score ?? ""),
          homeScore: String(home.score ?? ""),
          state: (ev.status?.type?.state as LiveGame["state"]) || "pre",
          detail: String(ev.status?.type?.detail || ""),
        });
      }
    })
  );

  // Prop settling (optimization #67): for FINAL games in the sports the
  // Cheatsheet engine covers (NFL/NBA/NHL), settle today's feed props
  // against the ESPN box score that engine already reads, so the card's
  // Won/Lost marker (#64) covers props too. The box fetch goes through
  // getEventBox with the dashed ET date — the same cache entry (and the
  // same dateET format) the Cheatsheet's game-log rows rely on. Anything
  // unparseable, unmatched, or ambiguous gets no result: the marker
  // stays absent and the morning grader remains the official word.
  try {
    const propPicks: FeedPick[] = [
      ...(feed?.props || []),
      ...(feed?.picks || []).filter((p) => p.market === "prop"),
    ];
    if (propPicks.length > 0) {
      await Promise.all(
        games
          .filter(
            (g) =>
              g.state === "post" && BOX_SPORTS.has(g.sport) && g.id !== ""
          )
          .map(async (g) => {
            const mine = propPicks.filter(
              (p) => sportFromGame(p.game) === g.sport && gameMatches(p.game, g)
            );
            if (mine.length === 0) return;
            const box = await getEventBox(
              g.sport,
              SCORE_PATH[g.sport],
              g.id,
              dateDash
            );
            if (!box) return;
            const results: PropResult[] = [];
            for (const p of mine) {
              const parsed = parseProp(p.play);
              if (!parsed) continue;
              const player = matchPlayer(box.players, parsed.playerQuery);
              if (!player) continue;
              const value = statValue(g.sport, parsed.market, player.stats);
              if (value === null) continue;
              results.push({
                play: p.play,
                direction: parsed.direction,
                line: parsed.line,
                value,
              });
            }
            if (results.length > 0) g.propResults = results;
          })
      );
    }
  } catch {
    /* prop settling is best-effort — the scores still serve */
  }

  if (redis) {
    try {
      await redis.set(key, games, { ex: 45 });
    } catch {
      /* cache is best-effort */
    }
  }
  return games;
}
