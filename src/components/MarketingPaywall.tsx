import Link from "next/link";
import type { PicksFeed } from "@/lib/picks";
import { getTrackRecord } from "@/lib/store";

/**
 * Marketing paywall page for non-members.
 * Sells the product: value prop, proof, features, pricing, CTA.
 * Includes one free pick as a taste.
 */
export default async function MarketingPaywall({
  feed,
  ctaHref,
  ctaLabel,
  subline,
  betaPlaceholder,
}: {
  feed: PicksFeed | null;
  ctaHref: string;
  ctaLabel: string;
  subline: string;
  betaPlaceholder?: boolean;
}) {
  const picks = feed?.picks || [];
  const freePick = picks.find((p) => p.star) || picks[0] || null;
  const lockedCount = picks.filter((p) => p !== freePick).length;

  // Pull track record highlights for social proof
  let starRecord: string | null = null;
  let winPct: string | null = null;
  try {
    const rec = await getTrackRecord();
    const stars = rec.picks.filter((p) => p.star && p.result !== "Pending");
    const w = stars.filter((p) => p.result === "Win").length;
    const l = stars.filter((p) => p.result === "Loss").length;
    if (w + l > 0) {
      starRecord = `${w}-${l}`;
      winPct = ((w / (w + l)) * 100).toFixed(1);
    }
  } catch {
    // Non-critical
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Hero */}
      <div className="text-center py-12 px-4">
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-4">
          MoyLine AI Pro
        </p>
        <h1 className="font-display text-5xl sm:text-6xl mb-4 leading-tight">
          Every edge.<br />
          <span className="gold-text">Every day.</span>
        </h1>
        <p className="text-muted text-lg mb-2 max-w-2xl mx-auto">
          {subline}
        </p>
        <p className="text-muted mb-8 max-w-2xl mx-auto">
          Our desk grinds every slate — spreads, totals, props, weather, injuries,
          line movement — and distills it into one card of only the plays that
          clear a strict quantified edge bar. No filler. No forced plays.
        </p>
        {betaPlaceholder ? (
          <span className="inline-block px-10 py-4 rounded-full border border-gold/40 text-gold/70 font-bold text-sm tracking-[0.25em]">
            BETA — INVITE ONLY
          </span>
        ) : (
          <>
            <Link href={ctaHref} className="btn-gold px-10 py-4 inline-block text-lg font-bold rounded-full">
              {ctaLabel}
            </Link>
            <p className="text-xs text-muted mt-3">Day, week, and monthly passes available</p>
          </>
        )}
      </div>

      {/* Social proof */}
      {starRecord && (
        <div className="card card-glow p-6 mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-2">
            ★ Featured plays · verified record
          </p>
          <p className="font-display text-5xl mb-1">
            <span className="text-emerald-400">{starRecord.split("-")[0]}</span>
            <span className="text-muted">–</span>
            <span className="text-red-400">{starRecord.split("-")[1]}</span>
            {winPct && <span className="text-gold text-3xl ml-3">{winPct}%</span>}
          </p>
          <p className="text-xs text-muted">Every pick graded and published — wins and losses</p>
        </div>
      )}

      {/* What members get */}
      <div className="grid sm:grid-cols-2 gap-4 mb-8">
        {[
          ["🎯 Daily card", "Every play that clears our edge bar, ranked by confidence. Never padded."],
          ["🎁 Teaser + Parlay", "Wong-rule teaser and quantified parlay of the day, every day."],
          ["🧪 Parlay Lab", "Build your own tickets from today's edges — we find the best combos."],
          ["🔨 Ticket Builder", "DIY parlay builder with AI verdict on your ticket's true edge."],
          ["🔔 Line alerts", "Set target lines, get pushed the instant books hit your number."],
          ["📊 Track record", "Full verified history. We publish losers too — that's the point."],
        ].map(([title, desc]) => (
          <div key={title} className="card p-5">
            <p className="font-bold mb-1">{title}</p>
            <p className="text-sm text-muted">{desc}</p>
          </div>
        ))}
      </div>

      {/* Free pick teaser */}
      {freePick && (
        <div className="mb-8">
          <h2 className="font-display text-3xl mb-4 text-center">
            Today's free pick <span className="text-lg">🎁</span>
          </h2>
          <div className="card card-glow p-6 max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-widest text-gold">
                Free {freePick.star && "★"}
              </span>
              <span className="text-xs text-muted">Conf {freePick.confidence}/5</span>
            </div>
            <h3 className="font-display text-2xl mb-2">{freePick.game}</h3>
            <p className="text-xl font-bold text-goldsoft mb-2">
              {freePick.play} <span className="text-sm text-muted">{freePick.price}</span>
            </p>
            {freePick.reasoning && <p className="text-sm text-muted">{freePick.reasoning}</p>}
          </div>
          {lockedCount > 0 && (
            <p className="text-center text-muted text-sm mt-4">
              Plus {lockedCount} more locked picks on today's card 🔒
            </p>
          )}
        </div>
      )}

      {/* Pricing preview — hidden until Stripe is live */}
      {!betaPlaceholder && (
      <div className="card p-8 mb-8 text-center">
        <h2 className="font-display text-3xl mb-6">Simple pricing</h2>
        <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
          {[
            ["Day Pass", "$9.99", "One-time", "Full card for a day"],
            ["Week Pass", "$19.99", "One-time", "Seven days of edges"],
            ["Monthly", "$49.99", "/month", "Every pick, every day"],
          ].map(([name, price, per, desc]) => (
            <div key={name} className="border border-line rounded-lg p-5">
              <p className="font-bold mb-1">{name}</p>
              <p className="font-display text-3xl text-gold mb-1">{price}</p>
              <p className="text-xs text-muted mb-2">{per}</p>
              <p className="text-sm text-muted">{desc}</p>
            </div>
          ))}
        </div>
        <Link href={ctaHref} className="btn-gold px-10 py-3 inline-block font-bold rounded-full mt-6">
          {ctaLabel}
        </Link>
      </div>
      )}

      {/* Honesty note */}
      <p className="text-center text-xs text-muted max-w-2xl mx-auto mb-8">
        We publish every pick — winners and losers. No cherry-picked records,
        no deleted tweets. The track record is the product.
      </p>
    </div>
  );
}
