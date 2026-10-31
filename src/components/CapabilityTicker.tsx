/**
 * Capability ticker (DeepChamp-inspired, 2026-10-31): a slow marquee of what
 * the desk actually does — capabilities, not claims. Pure CSS animation via
 * the shared .ticker class (same motion as the track-record ticker).
 */
const ITEMS = [
  "Daily intel",
  "Injury reports",
  "Line movement",
  "Live scores",
  "Props ranked by real hit rates",
  "Every pick graded & published",
  "Steam alerts",
  "Best price across 4 books",
  "Ask MoyAI",
  "The Undercard",
];

export default function CapabilityTicker() {
  const row = [...ITEMS, ...ITEMS];
  return (
    <div className="overflow-hidden border-y border-line/60 py-2 mb-6" aria-hidden="true">
      <div className="ticker">
        {row.map((item, i) => (
          <span
            key={i}
            className="text-[11px] font-bold uppercase tracking-[0.25em] text-muted"
          >
            {item} <span className="text-gold ml-10">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}
