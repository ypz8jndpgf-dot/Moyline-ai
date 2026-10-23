import Link from "next/link";
import { auth } from "@/lib/auth";
import { AskClient } from "./AskClient";
import { getOddsCached } from "@/lib/odds";
import { SPORT_LABELS } from "@/lib/odds-shared";

export const dynamic = "force-dynamic";

/** Team nickname (last word) — matches how the ask engine parses matchups. */
function nick(name: string): string {
  const parts = (name || "").trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

/**
 * Suggestion chips generated from today's actual board, so a chip can never
 * dead-end on a game that doesn't exist (the old static list referenced a
 * Rams–Cardinals game that wasn't on any slate). Falls back to undefined —
 * AskClient then uses its static list — when the board is thin.
 */
async function boardSuggestions(): Promise<string[] | undefined> {
  try {
    const { events } = await getOddsCached();
    const now = Date.now();
    const upcoming = (events || [])
      .filter((e) => new Date(e.commence_time).getTime() > now)
      .sort(
        (a, b) =>
          new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime()
      );
    if (upcoming.length < 2) return undefined;

    const out: string[] = [];
    const e1 = upcoming[0];
    out.push(`${nick(e1.away_team)} vs ${nick(e1.home_team)}`);

    const e2 = upcoming.find((e) => e.sport_key !== e1.sport_key) || upcoming[1];
    if (e2 && e2 !== e1) out.push(`Who wins ${nick(e2.away_team)} ${nick(e2.home_team)}?`);

    const e3 = upcoming.find((e) => e !== e1 && e !== e2);
    if (e3) out.push(`${nick(e3.away_team)} ${nick(e3.home_team)} spread`);

    const todayET = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    const tonight = upcoming.find(
      (e) =>
        new Date(e.commence_time).toLocaleDateString("en-CA", {
          timeZone: "America/New_York",
        }) === todayET
    );
    if (tonight) {
      out.push(`Any value in tonight's ${SPORT_LABELS[tonight.sport_key] || "games"}?`);
    }

    const chips = Array.from(new Set(out)).slice(0, 4);
    return chips.length >= 2 ? chips : undefined;
  } catch {
    return undefined;
  }
}

export default async function AskPage() {
  const session = await auth();

  if (!session?.user?.email) {
    return (
      <div className="max-w-xl mx-auto text-center py-10">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full border border-gold/40 bg-gold/10 text-gold text-[11px] font-bold uppercase tracking-[0.2em]">
          <span>✨</span> Ask MoyAI
        </div>
        <h1 className="font-display text-4xl mb-4">
          ASK <span className="gold-text">MOYAI</span>
        </h1>
        <p className="text-muted mb-6">
          Sign in to ask about any matchup — lines, leans, and confidence ratings.
        </p>
        <Link href="/signin" className="btn-gold px-8 py-3 inline-block">
          Sign in
        </Link>
      </div>
    );
  }

  const suggestions = await boardSuggestions();
  return <AskClient suggestions={suggestions} />;
}
