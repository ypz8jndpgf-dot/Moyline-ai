import { getOdds, getOpenings, getQuotaRemaining } from "@/lib/odds";
import { buildBoard } from "@/lib/board";
import OddsBoard from "@/components/OddsBoard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [oddsResult, openings] = await Promise.all([getOdds(), getOpenings()]);
  const { games, movers, sports } = buildBoard(oddsResult.events, openings);

  return (
    <div>
      <div className="mb-8 text-center sm:text-left">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-2">
          <span className="live-dot inline-block w-2 h-2 rounded-full bg-down mr-2" />
          Live odds board
        </p>
        <h1 className="font-display text-4xl sm:text-6xl leading-tight">
          EVERY BOOK. <span className="gold-text">EVERY LINE.</span>
          <br />
          ZERO MERCY.
        </h1>
        <p className="text-muted mt-3 max-w-2xl">
          Opening vs current lines side by side across DraftKings, FanDuel, BetMGM and Caesars —
          with steam alerts and best-price highlighting on every game.
        </p>
        {oddsResult.error && (
          <p className="mt-3 text-xs text-down bg-down/10 border border-down/30 rounded px-3 py-2 inline-block">
            {oddsResult.error}
          </p>
        )}
      </div>

      <OddsBoard
        games={games}
        movers={movers}
        sports={sports}
        updatedAt={oddsResult.fetchedAt ? new Date(oddsResult.fetchedAt).toISOString() : ""}
        quotaNote={
          getQuotaRemaining() !== null && getQuotaRemaining()! < 100
            ? `API quota low (${getQuotaRemaining()} left)`
            : undefined
        }
      />
    </div>
  );
}
