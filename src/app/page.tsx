import { getOdds, getOpenings, getQuotaRemaining } from "@/lib/odds";
import { buildBoard } from "@/lib/board";
import OddsBoard from "@/components/OddsBoard";
import FeaturedPlays from "@/components/FeaturedPlays";
import RecentResults from "@/components/RecentResults";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [oddsResult, openings] = await Promise.all([getOdds(), getOpenings()]);
  const { games, movers, sports } = buildBoard(oddsResult.events, openings);

  return (
    <div>
      <div className="mb-8 text-center sm:text-left">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full border border-gold/40 bg-gold/10 text-gold text-[11px] font-bold uppercase tracking-[0.2em]">
          <span>✦</span>
          Algo recalibrated Oct 16 — 359 bets analyzed, confidence tiers fixed
        </div>
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

      <FeaturedPlays />

      <div className="card p-6 mt-6 border-gold/30">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-gold text-lg">✦</span>
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold">
            Algo recalibrated — Oct 16
          </span>
        </div>
        <h2 className="font-display text-2xl sm:text-3xl mb-3">
          We found the leak. <span className="gold-text">We fixed it.</span>
        </h2>
        <p className="text-sm text-muted mb-4 max-w-3xl leading-relaxed">
          359 graded bets analyzed. The data was blunt: our "highest confidence" plays were hitting 38%,
          while our mid-tier plays were hitting 54%. The scale was upside-down. So we rebuilt it —
          confidence tiers recalibrated, star criteria sharpened to a 74% hit rate, moneylines prioritized,
          and sport-specific rules for NHL, NFL, soccer, and MLB.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="rounded border border-gold/20 bg-gold/5 px-3 py-3">
            <p className="text-2xl font-bold text-goldsoft">74%</p>
            <p className="text-[11px] text-muted uppercase tracking-wider mt-1">Sharpened ★ hit rate</p>
          </div>
          <div className="rounded border border-gold/20 bg-gold/5 px-3 py-3">
            <p className="text-2xl font-bold text-goldsoft">54%</p>
            <p className="text-[11px] text-muted uppercase tracking-wider mt-1">Workhorse tier (conf-3)</p>
          </div>
          <div className="rounded border border-gold/20 bg-gold/5 px-3 py-3">
            <p className="text-2xl font-bold text-goldsoft">66%</p>
            <p className="text-[11px] text-muted uppercase tracking-wider mt-1">NHL moneylines</p>
          </div>
          <div className="rounded border border-gold/20 bg-gold/5 px-3 py-3">
            <p className="text-2xl font-bold text-goldsoft">+5–8<span className="text-base">pp</span></p>
            <p className="text-[11px] text-muted uppercase tracking-wider mt-1">Expected lift</p>
          </div>
        </div>
        <p className="text-[11px] text-muted mt-4 italic">
          Every pick still graded and published. The track record doesn't hide — it improves.
        </p>
      </div>

      <RecentResults />

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
