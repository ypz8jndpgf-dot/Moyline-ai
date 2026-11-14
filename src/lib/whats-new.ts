/**
 * "What's new" feed (optimization #78): one line per shipped member
 * feature, newest first, rendered at /whats-new. Every entry names a
 * feature that actually shipped (optimization backlog "built" items,
 * with their build dates) — when a new build lands, append one entry
 * at the TOP of this list. Nothing aspirational goes here.
 */
export type WhatsNewEntry = {
  /** Build date, "YYYY-MM-DD". */
  date: string;
  title: string;
  blurb: string;
};

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    date: "2026-11-14",
    title: "Open at your book",
    blurb:
      "Every card pick now carries an \"Open at <book>\" link to your book's sportsbook — one tap instead of hunting the app for the game yourself.",
  },
  {
    date: "2026-11-14",
    title: "Add tonight's games to your calendar",
    blurb:
      "A 📅 button atop the card downloads today's games as a calendar file — matchup, start time, and the pick in the event note.",
  },
  {
    date: "2026-11-14",
    title: "What's new",
    blurb: "This page. New features get one line here the day they ship, so nothing lands silently anymore.",
  },
  {
    date: "2026-11-13",
    title: "Prop line alerts",
    blurb:
      "Line alerts now cover player props: set a target on a prop line and get pinged when the board reaches it.",
  },
  {
    date: "2026-11-13",
    title: "\"What did I miss\" inbox",
    blurb:
      "Missed a push? The Inbox tab keeps the last 7 days of alerts sent to you — card-live, new picks, the ★ alarm — so nothing is silently lost.",
  },
  {
    date: "2026-11-13",
    title: "Share your tail record",
    blurb:
      "My Tails now has a share card: your tail record as a branded image, with numbers drawn only from your verified graded tails.",
  },
  {
    date: "2026-11-11",
    title: "Won / Lost markers for props",
    blurb: "Settled prop picks on the card now carry the same Won / Lost marker sides and totals already had.",
  },
  {
    date: "2026-11-11",
    title: "Live score + countdown on My Tails",
    blurb: "Your tailed games show a live score and a starts-in countdown right on My Tails while they're in play.",
  },
  {
    date: "2026-11-10",
    title: "Won / Lost marker on settled picks",
    blurb: "Yesterday's card picks show their result on the card itself — no trip to the record page to see how a play landed.",
  },
  {
    date: "2026-11-10",
    title: "\"Card games only\" on the odds board",
    blurb: "One toggle filters the board to just the games on today's card.",
  },
  {
    date: "2026-11-10",
    title: "Export My Tails as CSV",
    blurb: "Your full tail history downloads as a spreadsheet from My Tails.",
  },
  {
    date: "2026-11-09",
    title: "\"Passes we considered\" on the card",
    blurb: "The games the desk researched and passed on are listed under the card, each with the one-line reason it didn't clear.",
  },
  {
    date: "2026-11-09",
    title: "Voided / corrected pick banners",
    blurb:
      "If a published pick is ever wrong after the fact, it shows a VOIDED or CORRECTED banner everywhere — and members who tailed it get alerted.",
  },
  {
    date: "2026-11-09",
    title: "\"Send me a test push\"",
    blurb: "The push bell can send you a test notification, so you can prove alerts work before the ★ alarm ever depends on them.",
  },
  {
    date: "2026-11-08",
    title: "Compare all books",
    blurb: "Each card pick expands to every book's live price for that market, with the best one marked.",
  },
  {
    date: "2026-11-08",
    title: "Top 3 Football Plays on the card",
    blurb: "Saturday and Sunday cards carry the day's three best football leans as their own ranked block.",
  },
  {
    date: "2026-11-08",
    title: "\"Lock it in\" hedge math",
    blurb: "My Tails shows the hedge math on a live tail — what locking in a profit (or cutting a loss) would take.",
  },
  {
    date: "2026-11-07",
    title: "Tail the whole card",
    blurb: "One tap on the card tails every upcoming play you haven't tailed yet.",
  },
  {
    date: "2026-11-07",
    title: "\"Card locks soon\" push",
    blurb: "A heads-up push lands before the day's first game starts, while every play on the card is still open.",
  },
  {
    date: "2026-11-07",
    title: "Live prices on My Tails",
    blurb: "Tailed picks show the current board price next to the price you tailed at.",
  },
  {
    date: "2026-11-05",
    title: "\"Starts in…\" countdown",
    blurb: "Upcoming card picks count down to their start time, then flip to a Live badge at tip.",
  },
  {
    date: "2026-11-02",
    title: "Filter the card by sport",
    blurb: "Chips atop the card narrow the grid to one sport, with counts — the ranked order never changes.",
  },
  {
    date: "2026-11-01",
    title: "Copy the whole card",
    blurb: "One button copies the full ranked card as plain text for dropping into a group chat.",
  },
  {
    date: "2026-11-01",
    title: "\"Tailed it\" links in the brief email",
    blurb: "Each pick in the morning brief carries its own tail link — one tap records the tail and lands you signed-in on My Tails.",
  },
  {
    date: "2026-10-30",
    title: "Sort the card by start time",
    blurb: "A toggle re-orders the card by first pitch / tip / kickoff; the rank badges keep the desk's order either way.",
  },
];
