import Link from "next/link";
import { getOdds, getOpenings, getQuotaRemaining } from "@/lib/odds";
import { buildBoard } from "@/lib/board";
import OddsBoard from "@/components/OddsBoard";
import FeaturedPlays from "@/components/FeaturedPlays";
import ProofStrip from "@/components/ProofStrip";
import FeaturedRecord from "@/components/FeaturedRecord";
import RecentResults from "@/components/RecentResults";
import GoldenRun from "@/components/GoldenRun";
import TrackHighlights from "@/components/TrackHighlights";
import TrackTicker from "@/components/TrackTicker";
import PromoVideo from "@/components/PromoVideo";

export const dynamic = "force-dynamic";

const TRENDS = [
  { pct: "74%", label: "Sharpened ★", detail: "14-5-1 · NHL/NFL ML & spread" },
  { pct: "72%", label: "Soccer conf-3", detail: "13-5 · never starred" },
  { pct: "66%", label: "NHL moneylines", detail: "Best sport · 27-18 overall" },
  { pct: "64%", label: "NFL conf-3", detail: "14-8 · the workhorse tier" },
  { pct: "61%", label: "CFB unders", detail: "11-7 · tempo + defense" },
  { pct: "58%", label: "Overs overall", detail: "14-10 · not just unders" },
  { pct: "57%", label: "Soccer overall", detail: "30-23-1 · consistent edge" },
  { pct: "54%", label: "Moneylines", detail: "61-52-1 · best pick type" },
];

export default async function Home() {
  const [oddsResult, openings] = await Promise.all([getOdds(), getOpenings()]);
  const { games, movers, sports } = buildBoard(oddsResult.events, openings);

  return (
    <div>
      {/* Hero */}
      <TrackTicker />

      <div className="mb-8 text-center sm:text-left">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full border border-gold/40 bg-gold/10 text-gold text-[11px] font-bold uppercase tracking-[0.2em]">
          <span>✦</span>
          Algo recalibrated Oct 16 — 359 bets analyzed
        </div>
        <h1 className="font-display text-4xl sm:text-6xl leading-tight">
          EVERY BOOK. <span className="gold-text">EVERY LINE.</span>
          <br />
          ZERO MERCY.
        </h1>
        <p className="text-muted mt-3 max-w-2xl">
          Data-driven picks across every major sport — every play graded and published,
          win or lose. Opening vs current lines side by side across DraftKings, FanDuel,
          BetMGM and Caesars, with steam alerts and best-price highlighting on every game.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 justify-center sm:justify-start">
          <Link
            href="/picks"
            className="px-5 py-2.5 rounded btn-gold font-bold text-sm"
          >
            Today's Picks 🔒
          </Link>
          <Link
            href="/track-record"
            className="px-5 py-2.5 rounded border border-gold/40 text-gold font-bold text-sm hover:bg-gold/10"
          >
            The Record
          </Link>
        </div>
      </div>

      {/* Social proof — the record, above the fold */}
      <ProofStrip />

      {/* Promo video */}
      <PromoVideo />

      {oddsResult.error && !oddsResult.error.includes("401") && (
          <p className="mt-3 text-xs text-muted bg-white/5 border border-white/10 rounded px-3 py-2 inline-block">
            Lines may be delayed — showing last available data.
          </p>
        )}

      <FeaturedPlays />

      <FeaturedRecord />

      <GoldenRun />

      {/* Where the edge lives — merged recalibration + trends */}
      <div className="mt-6 rounded border border-gold/40 bg-gradient-to-b from-gold/10 to-transparent p-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-gold text-lg">✦</span>
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold">
            Recalibrated Oct 16 · Where the edge lives
          </span>
        </div>
        <h2 className="font-display text-2xl sm:text-3xl mb-2">
          We found the leak. <span className="gold-text">We fixed it.</span>
        </h2>
        <p className="text-sm text-muted mb-5 max-w-3xl leading-relaxed">
          359 graded bets analyzed. The data was blunt: our "highest confidence" plays were
          hitting 38% while mid-tier plays hit 54% — the scale was upside-down. So we rebuilt
          it: tiers recalibrated, stars sharpened, moneylines prioritized, sport-specific rules.
          These are the segments that keep winning:
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {TRENDS.map((t) => (
            <div
              key={t.label}
              className="rounded border border-gold/30 bg-black/40 px-3 py-4 text-center"
            >
              <p className="text-3xl font-bold gold-text">{t.pct}</p>
              <p className="text-xs font-bold text-paper mt-1">{t.label}</p>
              <p className="text-[11px] text-muted mt-0.5">{t.detail}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted mt-4 italic">
          Full pick-by-pick record on the Record tab. No cherry-picking — losers included.
          The track record doesn't hide; it improves.
        </p>
      </div>

      <RecentResults />

      <TrackHighlights />

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

      {/* Beta CTA */}
      <div className="mt-8 mb-4 text-center rounded border border-gold/30 bg-gold/5 px-6 py-8">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-2">
          Beta access
        </p>
        <h2 className="font-display text-2xl sm:text-3xl mb-2">
          Get every pick. <span className="gold-text">Every day.</span>
        </h2>
        <p className="text-sm text-muted max-w-xl mx-auto mb-5">
          The full card, the Undercard, the Lab and Builder — plus steam alerts
          the moment a line moves on your games.
        </p>
        <span className="inline-block px-6 py-3 rounded-full border border-gold/40 text-gold/70 font-bold text-xs tracking-[0.25em]">
          BETA — INVITE ONLY
        </span>
      </div>
    </div>
  );
}
