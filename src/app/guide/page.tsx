import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * The game-day routine (DeepChamp-inspired guide page, MoyLine version,
 * 2026-10-31): how a member uses the desk in about ten minutes — Find,
 * Verify, Pressure-test, Track. Written from surfaces that actually exist.
 */
const STEPS: {
  n: string;
  title: string;
  when: string;
  body: string;
  link: { href: string; label: string };
}[] = [
  {
    n: "1",
    title: "Find",
    when: "7:00am ET — the card lands",
    body: "Start with Today's Picks: the full card ranked by confidence and edge, best price and book named on every play. The ★ is the day's single strongest edge. Second-tier leans with a real edge live on the Undercard — same grading, lower bar. Later editions (11am / 3pm weekends, 6pm daily) only add new games; the 7am card is the anchor.",
    link: { href: "/picks", label: "Today's Picks" },
  },
  {
    n: "2",
    title: "Verify",
    when: "Before you tail anything",
    body: "Every pick carries its line story — opened, published, now — so you can see whether the price you can still get is the price we graded. The board shows opening vs current lines across DraftKings, FanDuel, BetMGM and Caesars, and steam alerts fire when a line moves hard on a game on the card. If the number ran away, the honest move is to pass, not chase.",
    link: { href: "/", label: "The odds board" },
  },
  {
    n: "3",
    title: "Pressure-test",
    when: "The step most bettors skip",
    body: "Read the Risk line on the pick — the single most likely way it loses, in plain words. Ask MoyAI why the pick made the card and what changed. Building a parlay? The Cheatsheet ranks today's props by how often they've actually cashed (real fractions from real game logs, never a stamped 100%), and the Ticket Builder grades your combination before you place it.",
    link: { href: "/lab", label: "Parlay Lab & Cheatsheet" },
  },
  {
    n: "4",
    title: "Track",
    when: "During the games — and next morning",
    body: "Tap “Tailed it” on any pick to follow it: live scores run on the card while the game is on, and your tails keep their own record. At 6:30am the next morning every pick is graded and published — win or lose, nothing edited, nothing deleted. That's the deal: the record you read is the record there is.",
    link: { href: "/track-record", label: "The Record" },
  },
];

export default function GuidePage() {
  return (
    <div className="max-w-4xl mx-auto">
      <p className="text-xs font-bold uppercase tracking-[0.25em] text-gold mb-2">
        How it works
      </p>
      <h1 className="font-display text-4xl sm:text-5xl mb-3">
        The game-day <span className="gold-text">routine.</span>
      </h1>
      <p className="text-muted max-w-2xl mb-8">
        Four steps, about ten minutes. MoyLine is a research desk, not a tout — this is
        how to use it like one: find the edge, verify the price, pressure-test the pick,
        then track it in the open.
      </p>

      <div className="space-y-4">
        {STEPS.map((s) => (
          <div key={s.n} className="card p-5 sm:p-6">
            <div className="flex items-baseline gap-3 mb-1">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-gold/40 bg-gold/10 text-gold font-bold shrink-0">
                {s.n}
              </span>
              <h2 className="font-display text-2xl">{s.title}</h2>
              <span className="text-xs text-muted">{s.when}</span>
            </div>
            <p className="text-sm text-muted leading-relaxed mt-2">{s.body}</p>
            <p className="mt-3">
              <Link href={s.link.href} className="text-sm font-bold text-gold hover:underline">
                {s.link.label} →
              </Link>
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded border border-gold/40 bg-gradient-to-b from-gold/10 to-transparent p-6">
        <h2 className="font-display text-2xl mb-2">
          “What could make this pick <span className="gold-text">lose?</span>”
        </h2>
        <p className="text-sm text-muted leading-relaxed max-w-3xl">
          Ask it of every play — we do. It's why each pick ships with a Risk line and a
          full writeup, why the Cheatsheet shows real fractions instead of stamped hit
          rates, and why the results — including the ugly weeks — stay on the public
          record. No guarantees, no “lock of the century,” no deleted losers. If a
          service won't show you its losses, ask yourself what it's actually selling.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
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
            Read the Record first
          </Link>
        </div>
      </div>

      <p className="text-xs text-muted mt-6">
        Analysis for entertainment purposes — not financial advice. 21+. If gambling
        stops being fun, help is available at 1-800-GAMBLER.
      </p>
    </div>
  );
}
