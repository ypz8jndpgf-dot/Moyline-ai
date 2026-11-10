import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess, isFounder } from "@/lib/store";
import { getPicksFeed, PicksFeed, FeedPick, sportFromGame } from "@/lib/picks";
import { getOdds, getOpenings } from "@/lib/odds";
import { buildBoard, MoverVM } from "@/lib/board";
import { findBoardGame, bestPriceForPick, badgeBeatsPlay, movedAgainstNote, edgeGoneNote, propEdgeGoneNote, lineStoryForPick, bookPriceForPick, bookPricesForPick, selectCardSteamMoves, BestPrice, BookPriceRow } from "@/lib/card-utils";
import { pickWinEdge, winEdgeInfo, formatWinEdge } from "@/lib/winprob";
import { parseProp, livePropQuote } from "@/lib/cheatsheet";
import { readTails } from "@/lib/tails";
import TailButton from "./TailButton";
import TailAllButton from "./TailAllButton";
import ShareButton from "./ShareButton";
import CopyCardButton from "./CopyCardButton";
import LiveScore from "./LiveScore";
import StartsIn from "./StartsIn";
import PropHitRate from "./PropHitRate";
import MarketingPaywall from "@/components/MarketingPaywall";
import PickStatusBanner from "@/components/PickStatusBanner";
import { getYesterdayGlance, formatRecord, formatUnits } from "@/lib/records";
import PushPrompt from "@/components/PushPrompt";
import IosInstallPrompt from "@/components/IosInstallPrompt";
import { getPrefs, PREF_BOOKS } from "@/lib/prefs";
import { SPORT_LABELS } from "@/lib/odds-shared";
import PrefsCard from "./PrefsCard";

export const dynamic = "force-dynamic";

const SLOT_LABEL: Record<string, string> = {
  "7am": "7am",
  "11am": "11am",
  "6pm": "6pm",
  sat2pm: "Saturday",
  cfbdeepdive: "Deep Dive",
};

/** Slot-style key ("7am", "6pm") for an ISO timestamp's ET hour — the same
 *  key shape SLOT_LABEL is keyed by, so a label derived from a timestamp
 *  resolves through the exact lookup the card header uses for its edition
 *  list. Null when the timestamp is missing or unparseable. */
function slotKeyForTimeET(iso?: string): string | null {
  if (!iso) return null;
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return null;
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: true,
  }).format(dt); // e.g. "6 PM"
  const m = hourStr.match(/(\d{1,2})\s*(AM|PM)/i);
  if (!m) return null;
  return `${parseInt(m[1], 10)}${m[2].toLowerCase()}`;
}

/** "NEW · added 6pm" badge label (optimization #43) for a pick that arrived
 *  in a later edition, else null. The picks/update merge stamps one shared
 *  `now` as added_at for every pick in a push, so the card's earliest
 *  added_at is the first edition's batch: any pick stamped strictly later
 *  came from a later edition. A missing added_at earns no badge — never
 *  guessed. The edition label reuses the header's SLOT_LABEL lookup. */
function newPickLabel(p: FeedPick, firstAddedAt: number | null): string | null {
  if (!p.added_at || firstAddedAt === null) return null;
  const t = Date.parse(p.added_at);
  if (isNaN(t) || t <= firstAddedAt) return null;
  const key = slotKeyForTimeET(p.added_at);
  if (!key) return null;
  return `NEW · added ${SLOT_LABEL[key] || key}`;
}

/** Parse "7:00pm ET" / "2:45pm ET" -> minutes after midnight ET. Null if unparseable. */
function parseStart(starts?: string): number | null {
  if (!starts) return null;
  const m = starts.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3].toLowerCase();
  if (ap === "pm" && h !== 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h * 60 + min;
}

type Status = "upcoming" | "live" | "final";

/** Live window: started within the last 3.5h. After that, final (result pending grading). */
function statusFor(startMins: number | null, nowMins: number): Status {
  if (startMins === null) return "upcoming";
  if (nowMins < startMins) return "upcoming";
  if (nowMins < startMins + 210) return "live";
  return "final";
}

function nowETMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  return h * 60 + m;
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "live")
    return (
      <span className="text-[11px] font-bold uppercase tracking-wider text-down">● Live</span>
    );
  if (status === "final")
    return <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Final</span>;
  return null;
}

/** "2026-10-10" -> "Sat, Oct 10". */
function formatCardDate(dateStr?: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

/** ISO timestamp -> "2:14pm" ET. */
function formatTimeET(iso?: string): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "";
  return dt
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    })
    .replace(" ", "")
    .toLowerCase();
}

function PickCard({
  p,
  index,
  status,
  best,
  movedNote,
  edgeGone,
  lineStory,
  bookPrices,
  yourBook,
  initiallyTailed,
  cardDate,
  feedDate,
  newLabel,
}: {
  p: FeedPick;
  index: number;
  status: Status;
  best: BestPrice;
  movedNote?: string | null;
  edgeGone?: string | null;
  lineStory?: string | null;
  /** Per-book live prices for this pick's market (optimization #58). */
  bookPrices?: BookPriceRow[] | null;
  yourBook?: BestPrice;
  initiallyTailed: boolean;
  cardDate: string;
  /** Raw feed date ("YYYY-MM-DD") — the countdown's anchor (optimization #48). */
  feedDate?: string;
  /** "NEW · added 6pm" for later-edition picks (optimization #43), else null. */
  newLabel?: string | null;
}) {
  const winEdge = pickWinEdge(p);
  // Voided pick (optimization #62): the banner replaces every live-play
  // treatment — no best-price chasing, no edge-gone math, no tail action.
  const voided = p.status === "voided";
  const gameShort = (p.game || "").split("(")[0].trim();
  const askQuestions = [
    "Why this pick?",
    "How has the line moved?",
    "Any player props?",
  ];
  return (
    <div className="card card-glow p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-gold/40 bg-gold/10 text-gold text-xs font-bold tracking-widest">
            #{index + 1}
          </span>
          {p.star && <span className="text-gold text-sm leading-none">★</span>}
          {newLabel && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-up/40 bg-up/10 text-up text-xs font-bold tracking-widest">
              {newLabel}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <StatusBadge status={status} />
          {winEdge && !voided && <span className="text-xs text-muted">{winEdge}</span>}
        </span>
      </div>
      <PickStatusBanner p={p} className="mb-3" />
      <h3 className="font-display text-xl mb-1">{p.game}</h3>
      {p.starts && (
        <p className="text-xs text-muted mb-1">
          🕐 {cardDate ? `${cardDate} · ` : ""}
          {p.starts}
        </p>
      )}
      {status === "upcoming" && p.starts && !voided && (
        <StartsIn starts={p.starts} date={feedDate} />
      )}
      {status !== "upcoming" && (
        <LiveScore game={p.game} play={p.play} market={p.market} line={p.line} />
      )}
      <p
        className={`text-lg font-bold text-goldsoft mb-1 ${voided ? "line-through opacity-50" : ""}`}
      >
        {p.play} <span className="text-sm text-muted">{p.price}</span>
      </p>
      {(p.added_at || p.updated_at) && (
        <p className="text-[11px] text-muted mb-1">
          {p.updated_at && p.updated_at !== p.added_at
            ? `Updated ${formatTimeET(p.updated_at)}`
            : p.added_at
              ? `Added ${formatTimeET(p.added_at)}`
              : ""}
        </p>
      )}
      {!voided && best && (
        <p className="text-xs mb-2">
          <span className="inline-block bg-white/10 text-paper/80 px-2 py-0.5 rounded">
            Best price: {best.book} {best.display}
          </span>
        </p>
      )}
      {!voided && yourBook && (
        <p className="text-xs mb-2">
          <span className="inline-block bg-gold/10 text-goldsoft px-2 py-0.5 rounded border border-gold/30">
            Your book · {yourBook.book}: {yourBook.display}
          </span>
        </p>
      )}
      {!voided && !best && movedNote && (
        <p className="text-xs mb-2">
          <span className="inline-block bg-red-500/10 text-red-200/80 px-2 py-0.5 rounded">
            ⚠ {movedNote}
          </span>
        </p>
      )}
      {!voided && edgeGone && (
        <p className="text-xs mb-2">
          <span className="inline-block bg-red-500/15 text-red-100 px-2 py-0.5 rounded border border-red-400/40 font-bold">
            🚫 {edgeGone}
          </span>
        </p>
      )}
      {!voided && lineStory && (
        <p className="text-[11px] text-muted mb-2">📈 {lineStory}</p>
      )}
      {!voided && bookPrices && bookPrices.length > 1 && (
        <details className="mt-1 mb-2 group">
          <summary className="text-sm font-bold text-gold cursor-pointer list-none flex items-center gap-1">
            <span className="transition-transform group-open:rotate-90">▶</span>
            Compare all books
          </summary>
          <div className="mt-2 space-y-1">
            {bookPrices.map((r) => (
              <div key={r.book} className="flex items-center justify-between text-xs">
                <span className="text-muted">
                  {r.book}
                  {r.cardBook && <span className="text-goldsoft"> · card price</span>}
                </span>
                <span className={r.best ? "font-bold text-gold" : "text-paper/80"}>
                  {r.display}
                  {r.best ? " · best" : ""}
                </span>
              </div>
            ))}
            <p className="text-[11px] text-muted">
              Live board prices for this market · the card published {p.price}
            </p>
          </div>
        </details>
      )}
      {p.reasoning && <p className="text-sm text-muted">{p.reasoning}</p>}
      {p.risk && (
        <p className="text-xs text-red-200/70 mt-2">
          <span className="font-bold">Risk:</span> {p.risk}
        </p>
      )}
      {p.writeup && p.writeup !== p.reasoning && (
        <details className="mt-3 group">
          <summary className="text-sm font-bold text-gold cursor-pointer list-none flex items-center gap-1">
            <span className="transition-transform group-open:rotate-90">▶</span>
            Why this pick
          </summary>
          <p className="text-sm text-paper/90 mt-2 leading-relaxed">{p.writeup}</p>
        </details>
      )}
      {p.deep_dive && (
        <details className="mt-2 group">
          <summary className="text-sm font-bold text-gold cursor-pointer list-none flex items-center gap-1">
            <span className="transition-transform group-open:rotate-90">▶</span>
            Deep dive
          </summary>
          <div className="text-sm text-paper/90 mt-2 leading-relaxed space-y-2">
            {p.deep_dive.split("\n\n").map((para, j) => (
              <p key={j}>{para}</p>
            ))}
          </div>
        </details>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {askQuestions.map((q) => (
          <a
            key={q}
            href={`/ask?q=${encodeURIComponent(`${q} ${gameShort}`)}`}
            className="text-[11px] px-2 py-1 rounded-full border border-white/15 text-muted hover:text-goldsoft hover:border-gold/40 transition-colors"
          >
            💬 {q}
          </a>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {voided ? (
          <button
            disabled
            title={p.statusNote || "This pick was voided after publication"}
            className="text-xs font-bold px-3 py-1.5 rounded-full border border-red-500/40 text-red-300/70 cursor-not-allowed"
          >
            🚫 Voided — not playable
          </button>
        ) : (
          <>
            <TailButton game={p.game} play={p.play} price={p.price} initiallyTailed={initiallyTailed} />
            <ShareButton
              game={p.game}
              play={p.play}
              price={p.price}
              edgeCents={p.edge_cents}
              winProb={p.win_prob}
              star={!!p.star}
              dateLabel={cardDate}
              starts={p.starts}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Paywall preview: one free pick of the day is fully unlocked; the rest
 * stay locked. Game matchups are public; locked plays, prices and reasoning
 * are never rendered for non-members (not even blurred — they're omitted).
 */
function PaywallPreview({
  feed,
  ctaHref,
  ctaLabel,
  subline,
}: {
  feed: PicksFeed | null;
  ctaHref: string;
  ctaLabel: string;
  subline: string;
}) {
  const picks = feed?.picks || [];
  const freePick = picks.find((p) => p.star) || picks[0] || null;
  const locked = picks.filter((p) => p !== freePick);
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center py-10">
        <h1 className="font-display text-4xl mb-4">
          PRO PICKS <span className="gold-text">🔒</span>
        </h1>
        <p className="text-muted mb-2">{subline}</p>
        <p className="text-sm text-muted mb-6 max-w-lg mx-auto">
          Our desk grinds every slate — spreads, totals, props, weather,
          injuries, line movement — and distills it into one card of only the
          plays that clear our strict edge bar. Members also get the
          Teaser and Parlay of the Day, plus the Parlay Lab builder.
        </p>
        <Link href={ctaHref} className="btn-gold px-8 py-3 inline-block">
          {ctaLabel}
        </Link>
      </div>

      {freePick && (
        <div className="mb-6">
          <h2 className="font-display text-2xl mb-4 text-center">
            Free pick of the day <span className="text-sm">🎁</span>
          </h2>
          <div className="card card-glow p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-widest text-gold">
                Free {freePick.star && "★"}
              </span>
              <span className="text-xs text-muted">{pickWinEdge(freePick)}</span>
            </div>
            <h3 className="font-display text-xl mb-1">{freePick.game}</h3>
            {freePick.starts && (
              <p className="text-xs text-muted mb-1">
                🕐 {formatCardDate(feed?.date)} · {freePick.starts}
              </p>
            )}
            <PickStatusBanner p={freePick} className="mb-2" />
            <p
              className={`text-lg font-bold text-goldsoft mb-2 ${freePick.status === "voided" ? "line-through opacity-50" : ""}`}
            >
              {freePick.play} <span className="text-sm text-muted">{freePick.price}</span>
            </p>
            {freePick.reasoning && <p className="text-sm text-muted">{freePick.reasoning}</p>}
            {freePick.writeup && freePick.writeup !== freePick.reasoning && (
              <details className="mt-3 group">
                <summary className="text-sm font-bold text-gold cursor-pointer list-none flex items-center gap-1">
                  <span className="transition-transform group-open:rotate-90">▶</span>
                  Why this pick
                </summary>
                <p className="text-sm text-paper/90 mt-2 leading-relaxed">{freePick.writeup}</p>
              </details>
            )}
            {freePick.deep_dive && (
              <details className="mt-2 group">
                <summary className="text-sm font-bold text-gold cursor-pointer list-none flex items-center gap-1">
                  <span className="transition-transform group-open:rotate-90">▶</span>
                  Deep dive
                </summary>
                <div className="text-sm text-paper/90 mt-2 leading-relaxed space-y-2">
                  {freePick.deep_dive.split("\n\n").map((para, j) => (
                    <p key={j}>{para}</p>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      {locked.length > 0 && (
        <>
          <h2 className="font-display text-2xl mb-4 text-center">
            Today&apos;s card <span className="text-sm text-muted font-sans">({locked.length} more locked)</span>
          </h2>
          <div className="grid gap-4 md:grid-cols-2 relative">
            {locked.map((p, i) => (
              <div key={i} className="card p-5 relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-gold">
                    #{i + 1} {p.star && "★"}
                  </span>
                  <span className="text-xs text-muted">
                    {pickWinEdge(p)}{p.starts ? ` · ${formatCardDate(feed?.date)} ${p.starts}` : ""}
                  </span>
                </div>
                <h3 className="font-display text-xl mb-3">{p.game}</h3>
                <div className="rounded bg-white/5 px-3 py-2 text-sm text-muted blur-[6px] select-none" aria-hidden="true">
                  Locked pick — members only
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl">🔒</span>
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2 mt-4">
            <div className="card p-5 text-center">
              <span className="text-xs font-bold uppercase tracking-widest text-gold">Teaser of the Day</span>
              <p className="text-sm text-muted mt-2">🔒 Members only</p>
            </div>
            <div className="card p-5 text-center">
              <span className="text-xs font-bold uppercase tracking-widest text-gold">Parlay of the Day</span>
              <p className="text-sm text-muted mt-2">🔒 Members only</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default async function PicksPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; sport?: string }>;
}) {
  const { sort, sport } = await searchParams;
  const sortByTime = sort === "time";
  const session = await auth();
  const email = session?.user?.email || null;
  const sub = await getSubscription(email || "");
  const allowed = await hasAccess(email, sub);
  const founder = email ? await isFounder(email) : false;
  const feed = await getPicksFeed();

  if (!allowed) {
    return (
      <MarketingPaywall
        feed={feed}
        ctaHref="/signin"
        ctaLabel="Sign in"
        betaPlaceholder={!!session?.user}
        subline={
          session?.user
            ? `Signed in as ${email} — no active subscription.`
            : "Sign in to see if you have access to today's card."
        }
      />
    );
  }

  const editionSlots = feed?.editions || (feed?.slot ? [feed.slot] : []);
  const editions = editionSlots.map((s) => SLOT_LABEL[s] || s).join(" · ");
  const cardDate = formatCardDate(feed?.date);
  // Later-edition "NEW" badges (optimization #43): only on multi-edition
  // days, and only for picks stamped after the first edition's batch (the
  // merge stamps one shared added_at per push). Computed over the whole
  // card, so sport filtering and time sorting never change a pick's badge.
  const multiEdition = editionSlots.length > 1;
  const firstAddedAt = (feed?.picks || []).reduce<number | null>((min, p) => {
    if (!p.added_at) return min;
    const t = Date.parse(p.added_at);
    if (isNaN(t)) return min;
    return min === null || t < min ? t : min;
  }, null);
  const nowMins = nowETMinutes();

  // Odds board for best-price badges + steam detection (cached read, no API burn).
  let boardGames: Awaited<ReturnType<typeof buildBoard>>["games"] = [];
  let boardMovers: MoverVM[] = [];
  try {
    const [oddsResult, openings] = await Promise.all([getOdds(), getOpenings()]);
    const board = buildBoard(oddsResult.events, openings);
    boardGames = board.games;
    boardMovers = board.movers;
  } catch {
    /* odds unavailable — card renders without badges */
  }

  // Member personalization (steal #5): primary book gets a price line per pick.
  const prefs = email ? await getPrefs(email) : { sports: [] as string[], book: "", tailAlerts: false };

  const bestByPick = new Map<string, BestPrice>();
  const movedByPick = new Map<string, string | null>();
  const edgeGoneByPick = new Map<string, string | null>();
  const storyByPick = new Map<string, string | null>();
  const yourBookByPick = new Map<string, BestPrice>();
  const booksByPick = new Map<string, BookPriceRow[] | null>();
  for (const p of feed?.picks || []) {
    const key = `${p.game}|${p.play}`;
    const bg = findBoardGame(p, boardGames);
    if (bg) {
      // Compare-all-books rows (#58): same cached board, no new pulls.
      booksByPick.set(key, bookPricesForPick(p, bg));
      storyByPick.set(key, lineStoryForPick(p, bg));
      if (prefs.book) {
        yourBookByPick.set(key, bookPriceForPick(p, bg, prefs.book));
      }
      const bp = bestPriceForPick(p, bg);
      // Only show the badge when the live price is at least as good as the
      // locked-in play price — never contradict the card after line movement.
      // When the line moved against the pick, say so plainly instead
      // (optimization #16) so a late tailer never takes a worse number blind.
      if (bp && badgeBeatsPlay(p, bp)) {
        bestByPick.set(key, bp);
      } else {
        bestByPick.set(key, null);
        movedByPick.set(key, movedAgainstNote(p, bp));
      }
      // Edge-gone badge (optimization #52): the stronger claim beyond the
      // moved-against note — the live number has eaten the whole published
      // edge, with the cutoff a tailer must beat. Upcoming games only (a
      // tail decision exists only pre-game). Prop picks are priced from
      // the board-props cache in the block below, never the game board.
      if (
        statusFor(parseStart(p.starts), nowMins) === "upcoming" &&
        (p.market || "").toLowerCase() !== "prop"
      ) {
        edgeGoneByPick.set(key, edgeGoneNote(p, bp));
      }
    }
  }

  // Edge-gone for prop picks (optimization #52): the game board carries
  // no player props, so the live quote comes from the cheatsheet
  // board-props cache — a read-only cache read that never triggers an
  // Odds API fetch. No cache match → no badge, by design.
  if (feed?.date) {
    const propPicks = (feed.picks || []).filter(
      (p) =>
        (p.market || "").toLowerCase() === "prop" &&
        statusFor(parseStart(p.starts), nowMins) === "upcoming"
    );
    if (propPicks.length > 0) {
      try {
        const quotes = await Promise.all(
          propPicks.map((p) => livePropQuote(p, feed.date))
        );
        propPicks.forEach((p, i) => {
          const parsed = parseProp(p.play);
          if (!parsed) return;
          edgeGoneByPick.set(
            `${p.game}|${p.play}`,
            propEdgeGoneNote(p, parsed, quotes[i])
          );
        });
      } catch {
        /* board-props cache unavailable — props render without the badge */
      }
    }
  }

  // Steam section: the same strict selection as the alert emails — the
  // pick's own game, market and side only, collapsed to one line per
  // game+market+side across books. (The old per-pick fuzzy matcher listed
  // both teams at every book and once attached a Texas Tech CFB move to
  // Wild @ Canucks via the substring "wild" in "Wildcats".)
  const cardSteam = selectCardSteamMoves(feed?.picks || [], boardGames, boardMovers);

  // Yesterday strip (same track-record source as /track-record;
  // renders nothing when there's nothing graded).
  let yesterdayGlance: Awaited<ReturnType<typeof getYesterdayGlance>> = null;
  try {
    yesterdayGlance = await getYesterdayGlance();
  } catch {
    /* record unavailable — card renders without the strip */
  }

  // Member's tailed picks (for initial button state).
  const tails = email ? await readTails(email) : [];
  const tailedSet = new Set(tails.map((t) => `${t.game}|${t.play}`));

  // All picks in one flat list, ranked by confidence then edge (highest first).
  // The rank is computed once and stays on the card badge in both views;
  // ?sort=time only re-orders the display by start time (optimization #26).
  const rankedPicks = (feed?.picks || [])
    .map((p) => {
      const mins = parseStart(p.starts);
      return { p, status: statusFor(mins, nowMins), mins, rank: 0 };
    })
    .sort((a, b) => {
      const confDiff = (b.p.confidence || 0) - (a.p.confidence || 0);
      if (confDiff !== 0) return confDiff;
      const edgeDiff = (b.p.edge_cents || 0) - (a.p.edge_cents || 0);
      if (edgeDiff !== 0) return edgeDiff;
      return (a.mins ?? 9999) - (b.mins ?? 9999);
    });
  rankedPicks.forEach((r, i) => {
    r.rank = i;
  });
  const sortedPicks = sortByTime
    ? [...rankedPicks].sort(
        (a, b) => (a.mins ?? 9999) - (b.mins ?? 9999) || a.rank - b.rank
      )
    : rankedPicks;

  // Sport filter (optimization #34): chips for the sports actually on
  // today's card, derived from the league tag in each game string
  // ("Thunder @ Cavaliers (NBA)"). ?sport=NBA filters the grid in place;
  // rank badges, the copy-card text and the props strip stay whole-card.
  // An unknown sport param falls back to All.
  const cardSports = [...new Set(rankedPicks.map(({ p }) => sportFromGame(p.game)))];
  const activeSport =
    sport && cardSports.includes(sport.toUpperCase()) ? sport.toUpperCase() : null;
  const displayPicks = activeSport
    ? sortedPicks.filter(({ p }) => sportFromGame(p.game) === activeSport)
    : sortedPicks;
  const sportCount = (s: string) =>
    rankedPicks.filter(({ p }) => sportFromGame(p.game) === s).length;
  const picksHref = (sportVal: string | null, time: boolean) => {
    const qs = new URLSearchParams();
    if (time) qs.set("sort", "time");
    if (sportVal) qs.set("sport", sportVal);
    const s = qs.toString();
    return s ? `/picks?${s}` : "/picks";
  };

  // "Tail the whole card" (optimization #22): the upcoming grid picks
  // the member hasn't already tailed — the button hides itself when
  // there's nothing left to add. Props stay a per-pick choice.
  const tailAllPicks = rankedPicks
    .filter(
      ({ p, status }) =>
        status === "upcoming" &&
        p.status !== "voided" && // a dead play is never mass-tailed (#62)
        !tailedSet.has(`${p.game}|${p.play}`)
    )
    .map(({ p }) => ({ game: p.game, play: p.play, price: p.price }));

  // Thin-card note (optimization #54): a 1–2 pick card says nothing
  // about why today, and can read as "they gave up". One honest line —
  // the gates are the reason, and the leans that didn't clear were
  // never going to be padding.
  const thinCard = rankedPicks.length >= 1 && rankedPicks.length <= 2;

  // Plain-text version of the whole grid for the copy-card button
  // (optimization #33): ranked order, one line per pick.
  const cardCopyText = [
    `MoyLine AI — ${cardDate}`,
    ...rankedPicks.map(({ p }) => {
      const badge = pickWinEdge(p);
      return `${p.star ? "★ " : ""}${p.game} · ${p.play}${p.price ? ` ${p.price}` : ""}${badge ? ` (${badge})` : ""}`;
    }),
    "Full card: moylineai.com/picks",
  ].join("\n");

  return (
    <div>
      <h1 className="font-display text-4xl mb-1">
        TODAY&apos;S <span className="gold-text">CARD</span>
      </h1>
      <p className="text-muted text-sm mb-1">
        Pro members only · {email}
        {editions && <> · {editions} edition{editions.includes("·") ? "s" : ""}</>} ·{" "}
        <Link href="/my-tails" className="underline hover:text-gold">
          My tails ({tails.length})
        </Link>
      </p>
      <p className="text-xs text-muted mb-6">
        Best-price tags compare the four books on that pick — they&apos;re not extra picks.
      </p>

      {founder && (
        <div className="mb-6 rounded-xl border border-gold/60 bg-gold/10 px-4 py-3 flex items-center gap-3">
          <span className="text-2xl" aria-hidden>
            🏅
          </span>
          <p className="text-sm">
            <span className="font-extrabold text-gold tracking-wide">FOUNDING MEMBER</span>{" "}
            — thanks for piloting the beta with us. Your access is <b>free for life</b>.
          </p>
        </div>
      )}

      <PushPrompt />
      <IosInstallPrompt />

      {yesterdayGlance && (
        <p className="text-sm mb-3">
          <span className="text-muted">Yesterday:</span>{" "}
          <span className="font-bold">{formatRecord(yesterdayGlance.stat)}</span>
          {yesterdayGlance.units !== null && (
            <span className="text-muted"> · {formatUnits(yesterdayGlance.units)}</span>
          )}{" "}
          <Link href="/track-record" className="underline hover:text-gold">
            → full record
          </Link>
        </p>
      )}

      <details className="mb-6">
        <summary className="text-xs text-muted cursor-pointer hover:text-gold">
          What the numbers mean
        </summary>
        <div className="text-xs text-muted mt-2 space-y-1 max-w-xl">
          <p>
            Every play carries two numbers. <strong className="text-paper">Win%</strong> is
            the model win probability — the chance our fair price gives the play of
            cashing. <strong className="text-paper">Edge</strong> is how far the
            book&apos;s price sits from that fair price, in cents:{" "}
            <strong className="text-paper">+35¢ edge</strong> means the book is offering
            35¢ better than the price we&apos;d make it ourselves. A play only makes the
            card with a real quantified edge and a confirmed driver behind it — the
            bigger the edge at a gettable price, the stronger the play.
          </p>
          <p>
            The win% is also <strong className="text-paper">calibrated</strong>: it&apos;s
            fitted to our own graded record, so a play shown at 55% is at a level where
            picks have historically won about 55% of the time. The fit comes straight
            from the{" "}
            <Link href="/track-record" className="underline hover:text-gold">
              Model calibration table
            </Link>{" "}
            — the sample behind it is still young, so the fit is coarse, and it refits
            as more picks grade.
          </p>
          <p>
            Every play is graded after the game, win or lose — the full record, cut
            every way we track it, lives on the{" "}
            <Link href="/track-record" className="underline hover:text-gold">record page</Link>.
          </p>
        </div>
      </details>

      <PrefsCard
        sportOptions={Object.entries(SPORT_LABELS).map(([key, label]) => ({ key, label }))}
        books={PREF_BOOKS}
      />

      {feed?.intel && feed.intel.length > 0 && (
        <div className="card p-5 mb-8">
          <h2 className="font-display text-xl mb-3">📋 Today&apos;s intel</h2>
          <ul className="text-sm space-y-2">
            {feed.intel.map((item, i) => (
              <li key={i}>
                <span className="font-bold">{item.headline}</span>
                {item.detail && <span className="text-muted"> — {item.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!feed || feed.picks.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg mb-2">Today&apos;s card is being prepared.</p>
          <p className="text-sm text-muted">Check back shortly — picks post with the 7am brief.</p>
        </div>
      ) : (
        <>
          {cardSteam.length > 0 && (
            <div className="card p-5 mb-8 border-gold/40">
              <h2 className="font-display text-xl mb-3">
                🔥 Steam on your card
              </h2>
              <ul className="text-sm space-y-2">
                {cardSteam.map((mv) => (
                  <li key={mv.id}>
                    <span className="font-bold">{mv.game}</span>
                    <span className="text-muted"> — </span>
                    <span className="text-paper">
                      {mv.label} <span className="text-muted">({mv.detail})</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {thinCard && (
            <p className="text-sm text-muted border border-line rounded-xl px-4 py-3 mb-4">
              <span className="text-gold font-bold">Thin card by design.</span>{" "}
              Every play has to clear the full gate set — a quantified edge and a
              confirmed driver — and today only {rankedPicks.length}{" "}
              {rankedPicks.length === 1 ? "play" : "plays"} did. The leans that
              didn&apos;t clear are in the brief
              {feed.passes && feed.passes.length > 0 ? " — and listed below" : ""};
              the card is never padded.
            </p>
          )}

          {cardSports.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted mr-1">
                Sport
              </span>
              <Link
                href={picksHref(null, sortByTime)}
                className={`text-xs font-bold px-3 py-1.5 rounded-full border ${!activeSport ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-muted hover:text-gold"}`}
              >
                All ({rankedPicks.length})
              </Link>
              {cardSports.map((s) => (
                <Link
                  key={s}
                  href={picksHref(s, sortByTime)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-full border ${activeSport === s ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-muted hover:text-gold"}`}
                >
                  {s} ({sportCount(s)})
                </Link>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <p className="text-xs font-bold uppercase tracking-widest text-gold">
              {sortByTime
                ? "Ordered by start time — badges keep the ranked order"
                : "Ranked — #1 is our top play"}
              {activeSport && (
                <> · {activeSport} only — {displayPicks.length} of {rankedPicks.length}</>
              )}
            </p>
            <span className="flex items-center gap-2 text-xs font-bold">
              <TailAllButton picks={tailAllPicks} date={feed?.date} />
              <CopyCardButton text={cardCopyText} />
              <span className="flex items-center gap-1">
              <Link
                href={picksHref(activeSport, false)}
                className={`px-2.5 py-1 rounded-full border ${sortByTime ? "border-line text-muted hover:text-gold" : "border-gold/60 bg-gold/10 text-gold"}`}
              >
                Ranked
              </Link>
              <Link
                href={picksHref(activeSport, true)}
                className={`px-2.5 py-1 rounded-full border ${sortByTime ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-muted hover:text-gold"}`}
              >
                🕐 Start time
              </Link>
              </span>
            </span>
          </div>
          {displayPicks.length === 0 ? (
            <div className="card p-8 text-center mb-8">
              <p className="text-lg mb-2">No {activeSport} picks on today&apos;s card.</p>
              <p className="text-sm text-muted">
                <Link href={picksHref(null, sortByTime)} className="underline hover:text-gold">
                  View the whole card
                </Link>
              </p>
            </div>
          ) : (
          <div className="grid gap-4 md:grid-cols-2 mb-8">
            {displayPicks.map(({ p, status, rank }) => {
              const key = `${p.game}|${p.play}`;
              return (
                <PickCard
                  key={key}
                  p={p}
                  index={rank}
                  status={status}
                  best={bestByPick.get(key) || null}
                  movedNote={movedByPick.get(key) || null}
                  edgeGone={edgeGoneByPick.get(key) || null}
                  lineStory={storyByPick.get(key) || null}
                  bookPrices={booksByPick.get(key) || null}
                  yourBook={yourBookByPick.get(key) || null}
                  initiallyTailed={tailedSet.has(key)}
                  cardDate={cardDate}
                  feedDate={feed?.date}
                  newLabel={multiEdition ? newPickLabel(p, firstAddedAt) : null}
                />
              );
            })}
          </div>
          )}

          {feed.top3 && feed.top3.length > 0 && (
            <div className="card p-5 mb-8 border-gold/30">
              <h2 className="font-display text-xl mb-1">🏈 Top 3 Football Plays</h2>
              <p className="text-xs text-muted mb-4">
                The day&apos;s best football leans, ranked — set by the morning brief and
                updated only on a material line move or a better lean.
              </p>
              <div className="space-y-3">
                {feed.top3.map((tp, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 border-l-2 border-gold/40 pl-3"
                  >
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-gold/40 bg-gold/10 text-gold text-xs font-bold shrink-0">
                      #{i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-bold text-paper">{tp.game}</p>
                      <p
                        className={`text-sm text-goldsoft ${tp.status === "voided" ? "line-through opacity-50" : ""}`}
                      >
                        {tp.play} <span className="text-muted">{tp.price}</span>
                      </p>
                      <p className="text-xs text-muted">
                        {tp.status === "voided" ? "" : pickWinEdge(tp)}
                        {tp.starts ? ` · 🕐 ${tp.starts}` : ""}
                      </p>
                      {tp.reasoning && (
                        <p className="text-xs text-muted mt-1">{tp.reasoning}</p>
                      )}
                      <PickStatusBanner p={tp} className="mt-2" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {feed.props && feed.props.length > 0 && (
            <div className="card p-5 mb-8">
              <h2 className="font-display text-xl mb-1">🎯 Notable props</h2>
              <p className="text-xs text-muted mb-4">
                Prop leans from today&apos;s brief — the same legs the Parlay Lab builds from.
              </p>
              <div className="space-y-3">
                {feed.props.map((prop, i) => {
                  const key = `${prop.game}|${prop.play}`;
                  return (
                    <div
                      key={i}
                      className="flex items-start justify-between gap-3 border-l-2 border-gold/40 pl-3"
                    >
                      <div>
                        <p className="text-sm font-bold text-paper">{prop.game}</p>
                        <p
                          className={`text-sm text-goldsoft ${prop.status === "voided" ? "line-through opacity-50" : ""}`}
                        >
                          {prop.play} <span className="text-muted">{prop.price}</span>
                        </p>
                        <p className="text-xs text-muted">
                          {prop.status === "voided" ? "" : pickWinEdge(prop)}
                          {prop.starts ? ` · 🕐 ${prop.starts}` : ""}
                        </p>
                        {prop.reasoning && (
                          <p className="text-xs text-muted mt-1">{prop.reasoning}</p>
                        )}
                        <PickStatusBanner p={prop} className="mt-2" />
                        {prop.status !== "voided" && (
                          <PropHitRate game={prop.game} play={prop.play} />
                        )}
                      </div>
                      {prop.status === "voided" ? (
                        <span className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full border border-red-500/40 text-red-300/70">
                          🚫 Voided
                        </span>
                      ) : (
                        <TailButton
                          game={prop.game}
                          play={prop.play}
                          price={prop.price}
                          initiallyTailed={tailedSet.has(key)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-4">
            <div className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-widest text-gold">
                  Teaser of the Day
                </span>
                {feed.teaser && formatWinEdge(winEdgeInfo(feed.teaser)) && (
                  <span className="text-xs text-muted">{formatWinEdge(winEdgeInfo(feed.teaser))}</span>
                )}
              </div>
              {feed.teaser ? (
                <>
                  <p className="text-lg font-bold text-goldsoft mb-2">
                    {feed.teaser.points}-pt teaser
                  </p>
                  <ul className="text-sm text-paper mb-2 list-disc list-inside">
                    {feed.teaser.legs.map((leg, j) => (
                      <li key={j}>{leg}</li>
                    ))}
                  </ul>
                  {feed.teaser.reasoning && (
                    <p className="text-sm text-muted">{feed.teaser.reasoning}</p>
                  )}
                  <div className="mt-3">
                    <ShareButton
                      game="Teaser of the Day"
                      play={feed.teaser.legs.join(" · ")}
                      price={`${feed.teaser.points}-pt teaser`}
                      winProb={feed.teaser.win_prob}
                      dateLabel={cardDate}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted">No teaser today — nothing cleared the bar.</p>
              )}
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-widest text-gold">
                  Parlay of the Day
                </span>
                {feed.parlay && formatWinEdge(winEdgeInfo({ price: feed.parlay.odds, win_prob: feed.parlay.win_prob })) && (
                  <span className="text-xs text-muted">{formatWinEdge(winEdgeInfo({ price: feed.parlay.odds, win_prob: feed.parlay.win_prob }))}</span>
                )}
              </div>
              {feed.parlay ? (
                <>
                  <p className="text-lg font-bold text-goldsoft mb-2">
                    {feed.parlay.odds}{" "}
                    <span className="text-sm text-muted">({feed.parlay.book})</span>
                  </p>
                  <ul className="text-sm text-paper mb-2 list-disc list-inside">
                    {feed.parlay.legs.map((leg, j) => (
                      <li key={j}>{leg}</li>
                    ))}
                  </ul>
                  {feed.parlay.reasoning && (
                    <p className="text-sm text-muted">{feed.parlay.reasoning}</p>
                  )}
                  <div className="mt-3">
                    <ShareButton
                      game="Parlay of the Day"
                      play={feed.parlay.legs.join(" · ")}
                      price={`${feed.parlay.odds} (${feed.parlay.book})`}
                      winProb={feed.parlay.win_prob}
                      dateLabel={cardDate}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted">No parlay today — nothing cleared the bar.</p>
              )}
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-widest text-gold">
                  🎯 Longshot of the Day
                </span>
                <span className="text-xs text-muted">Ledger play · +300 or longer</span>
              </div>
              {feed.longshot ? (
                <>
                  <p className="text-lg font-bold text-goldsoft mb-2">
                    {feed.longshot.play}{" "}
                    <span className="text-gold">{feed.longshot.price}</span>
                  </p>
                  <p className="text-sm text-paper mb-2">{feed.longshot.game}</p>
                  {feed.longshot.reasoning && (
                    <p className="text-sm text-muted">{feed.longshot.reasoning}</p>
                  )}
                  <p className="mt-2 text-[11px] text-muted">
                    High variance by design — tracked in the Longshot Ledger, never in the main record.
                  </p>
                  <div className="mt-3">
                    <ShareButton
                      game={feed.longshot.game}
                      play={feed.longshot.play}
                      price={feed.longshot.price}
                      dateLabel={cardDate}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted">No longshot today — no +300 shot earned it.</p>
              )}
            </div>
          </div>

          {feed.lookaheads?.teaser && (
            <div className="card p-5 mt-4 border-gold/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-widest text-gold">
                  Weekend NFL Lookahead
                </span>
                <span className="text-xs text-muted">
                  Settles {feed.lookaheads.teaser.target_date}
                  {formatWinEdge(winEdgeInfo(feed.lookaheads.teaser)) &&
                    ` · ${formatWinEdge(winEdgeInfo(feed.lookaheads.teaser))}`}
                </span>
              </div>
              <p className="text-lg font-bold text-goldsoft mb-2">
                {feed.lookaheads.teaser.points}-pt Wong teaser
              </p>
              <ul className="text-sm text-paper mb-2 list-disc list-inside">
                {feed.lookaheads.teaser.legs.map((leg, j) => (
                  <li key={j}>{leg}</li>
                ))}
              </ul>
              {feed.lookaheads.teaser.reasoning && (
                <p className="text-sm text-muted">{feed.lookaheads.teaser.reasoning}</p>
              )}
            </div>
          )}

          {feed.lookaheads?.spotlight && (
            <div className="card p-5 mt-4 border-gold/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-widest text-gold">
                  Weekend NCAAB Lookahead
                </span>
                <span className="text-xs text-muted">
                  Settles {feed.lookaheads.spotlight.target_date}
                </span>
              </div>
              <div className="space-y-3">
                {feed.lookaheads.spotlight.picks.map((pick, j) => (
                  <div key={j} className="border-l-2 border-gold/40 pl-3">
                    <p className="text-sm font-bold text-paper">{pick.game}</p>
                    <p className="text-sm text-goldsoft">{pick.play} <span className="text-muted">{pick.price}</span></p>
                    <p className="text-xs text-muted">{pickWinEdge(pick)}</p>
                    {pick.reasoning && (
                      <p className="text-xs text-muted mt-1">{pick.reasoning}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {feed.passes && feed.passes.length > 0 && (
            <div className="card p-5 mt-4">
              <h2 className="font-display text-xl mb-1">🔍 Considered &amp; passed</h2>
              <p className="text-xs text-muted mb-4">
                The whole slate gets researched every day. These games were covered
                and left off the card — the edge or the driver wasn&apos;t there.
              </p>
              <ul className="space-y-2">
                {feed.passes.map((ps, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-bold text-paper">{ps.game}</span>
                    <span className="text-muted"> — {ps.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <p className="text-xs text-muted mt-8">Analysis for entertainment purposes — not financial advice.</p>
    </div>
  );
}
