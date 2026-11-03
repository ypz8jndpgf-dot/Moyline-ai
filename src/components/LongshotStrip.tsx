import { getPicksFeed } from "@/lib/picks";
import { getLongshotEntries, longshotTally } from "@/lib/longshot";

/**
 * Longshot Ledger strip (2026-11-02, suggestion #37): today's longshot
 * plus the running public tally — cashed count, biggest hit, record at
 * flat 1u. The ledger is deliberately separate from the main record:
 * these are labeled lottery tickets, and their numbers never mix with
 * the card's. Renders nothing until the first longshot is published.
 */
export default async function LongshotStrip() {
  let today: { game: string; play: string; price: string } | null = null;
  try {
    const feed = await getPicksFeed();
    if (feed?.longshot) {
      today = {
        game: feed.longshot.game,
        play: feed.longshot.play,
        price: feed.longshot.price,
      };
    }
  } catch {
    today = null;
  }

  const entries = await getLongshotEntries().catch(() => []);
  const tally = longshotTally(entries);

  if (!today && tally.played === 0) return null;

  return (
    <div className="mb-8 rounded-lg border border-gold/30 bg-black/40 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.2em] text-gold">
          🎯 Longshot Ledger
        </p>
        {tally.played > 0 && (
          <p className="text-xs text-muted">
            {tally.cashed} cashed · {tally.wins}-{tally.losses}
            {tally.pushes > 0 ? `-${tally.pushes}` : ""} all-time ·{" "}
            {tally.units >= 0 ? "+" : ""}
            {tally.units.toFixed(2)}u
            {tally.biggest !== null ? ` · biggest +${tally.biggest}` : ""}
          </p>
        )}
      </div>
      {today ? (
        <p className="mt-2 text-sm sm:text-base">
          <span className="text-muted">Today&apos;s shot:</span>{" "}
          <strong>{today.play}</strong>{" "}
          <span className="text-gold font-bold">{today.price}</span>{" "}
          <span className="text-muted">— {today.game}</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">
          No longshot today — the ledger only fires when a +300 shot earns it.
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted">
        One high-variance play a day at +300 or longer, tracked on its own —
        never counted in the main record.
      </p>
    </div>
  );
}
