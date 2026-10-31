/**
 * Live scores for card picks (optimization #28, built 2026-10-31): today's
 * ESPN scoreboards for the sports on the card, normalized into name-variant
 * lists the client matches pick game strings against. Server-cached in
 * Redis for 45s so member traffic never hammers ESPN. Scores only — the
 * official result still comes from the morning grader.
 */

import { Redis } from "@upstash/redis";
import { getPicksFeed, sportFromGame } from "@/lib/picks";

export interface LiveGame {
  sport: string;
  away: string[]; // name variants: display, short, abbreviation
  home: string[];
  awayScore: string;
  homeScore: string;
  state: "pre" | "in" | "post";
  detail: string; // e.g. "Q3 - 4:12", "Final"
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

  const dateET = new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/New_York" })
    .replace(/-/g, "");
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

  if (redis) {
    try {
      await redis.set(key, games, { ex: 45 });
    } catch {
      /* cache is best-effort */
    }
  }
  return games;
}
