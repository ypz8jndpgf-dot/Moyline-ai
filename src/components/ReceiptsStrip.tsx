import Link from "next/link";
import { getTrackRecord } from "@/lib/store";

/**
 * Receipts strip (DeepChamp-inspired "proof by product", MoyLine-honest
 * version, 2026-10-31): operational facts a member can verify, instead of
 * win-rate claims. The bet count comes from the live track record; if it
 * can't load, the strip still renders with the count omitted.
 */
export default async function ReceiptsStrip() {
  let betCount: number | null = null;
  try {
    const rec = await getTrackRecord();
    const t = rec.totals;
    if (t && t.w + t.l + t.p > 0) betCount = t.w + t.l + t.p;
  } catch {
    /* count is a bonus, never a blocker */
  }

  const facts: { big: string; small: string }[] = [
    { big: "7:00am ET", small: "The full card lands every morning" },
    { big: "6:30am ET", small: "Yesterday's card graded & published — win or lose" },
    ...(betCount
      ? [{ big: String(betCount), small: "Graded bets on the public record, losers included" }]
      : []),
    { big: "Nightly", small: "Site numbers tie out to the official tracker, bet for bet" },
  ];

  return (
    <div className="mt-6 rounded border border-gold/40 bg-gradient-to-b from-gold/10 to-transparent p-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-gold text-lg">✦</span>
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-gold">
          Receipts, not takes
        </span>
      </div>
      <h2 className="font-display text-2xl sm:text-3xl mb-2">
        We publish what other sites <span className="gold-text">bury.</span>
      </h2>
      <p className="text-sm text-muted mb-5 max-w-3xl leading-relaxed">
        No screenshot testimonials, no cherry-picked screenshots of winning slips. The
        product is a research desk with an open book: every pick settled in public, on
        the record, forever.
      </p>
      <div className={`grid grid-cols-2 ${betCount ? "sm:grid-cols-4" : "sm:grid-cols-3"} gap-3`}>
        {facts.map((f) => (
          <div key={f.big} className="rounded border border-gold/30 bg-black/40 px-3 py-4 text-center">
            <p className="text-2xl font-bold gold-text">{f.big}</p>
            <p className="text-[11px] text-muted mt-1 leading-snug">{f.small}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted mt-4 italic">
        Operational facts, verified Oct 31, 2026. New here?{" "}
        <Link href="/guide" className="text-gold not-italic font-bold hover:underline">
          Read the game-day routine →
        </Link>
      </p>
    </div>
  );
}
