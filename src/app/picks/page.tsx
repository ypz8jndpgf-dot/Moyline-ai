import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess, isFounder } from "@/lib/store";
import { getPicksFeed, PicksFeed, FeedPick } from "@/lib/picks";
import { getOdds, getOpenings } from "@/lib/odds";
import { buildBoard, MoverVM } from "@/lib/board";
import { findBoardGame, bestPriceForPick, badgeBeatsPlay, movedAgainstNote, lineStoryForPick, modelWinProb, bookPriceForPick, selectCardSteamMoves, BestPrice } from "@/lib/card-utils";
import { readTails } from "@/lib/tails";
import TailButton from "./TailButton";
import ShareButton from "./ShareButton";
import MarketingPaywall from "@/components/MarketingPaywall";
import { getYesterdayGlance, getConfidenceCalibration, formatRecord, formatUnits } from "@/lib/records";
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
  lineStory,
  winProb,
  yourBook,
  initiallyTailed,
  cardDate,
}: {
  p: FeedPick;
  index: number;
  status: Status;
  best: BestPrice;
  movedNote?: string | null;
  lineStory?: string | null;
  winProb?: number | null;
  yourBook?: BestPrice;
  initiallyTailed: boolean;
  cardDate: string;
}) {
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
        </span>
        <span className="flex items-center gap-2">
          <StatusBadge status={status} />
          <span className="text-xs text-muted">Conf {p.confidence}/5</span>
        </span>
      </div>
      <h3 className="font-display text-xl mb-1">{p.game}</h3>
      {p.starts && (
        <p className="text-xs text-muted mb-1">
          🕐 {cardDate ? `${cardDate} · ` : ""}
          {p.starts}
        </p>
      )}
      <p className="text-lg font-bold text-goldsoft mb-1">
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
      {best && (
        <p className="text-xs mb-2">
          <span className="inline-block bg-white/10 text-paper/80 px-2 py-0.5 rounded">
            Best price: {best.book} {best.display}
          </span>
        </p>
      )}
      {yourBook && (
        <p className="text-xs mb-2">
          <span className="inline-block bg-gold/10 text-goldsoft px-2 py-0.5 rounded border border-gold/30">
            Your book · {yourBook.book}: {yourBook.display}
          </span>
        </p>
      )}
      {winProb != null && (
        <p className="text-xs text-muted mb-2">
          Model win prob ~{winProb}% at our fair price
        </p>
      )}
      {!best && movedNote && (
        <p className="text-xs mb-2">
          <span className="inline-block bg-red-500/10 text-red-200/80 px-2 py-0.5 rounded">
            ⚠ {movedNote}
          </span>
        </p>
      )}
      {lineStory && (
        <p className="text-[11px] text-muted mb-2">📈 {lineStory}</p>
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
        <TailButton game={p.game} play={p.play} price={p.price} initiallyTailed={initiallyTailed} />
        <ShareButton
          game={p.game}
          play={p.play}
          price={p.price}
          confidence={p.confidence}
          star={!!p.star}
          dateLabel={cardDate}
          starts={p.starts}
        />
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
          plays that clear our strict confidence bar. Members also get the
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
              <span className="text-xs text-muted">Conf {freePick.confidence}/5</span>
            </div>
            <h3 className="font-display text-xl mb-1">{freePick.game}</h3>
            {freePick.starts && (
              <p className="text-xs text-muted mb-1">
                🕐 {formatCardDate(feed?.date)} · {freePick.starts}
              </p>
            )}
            <p className="text-lg font-bold text-goldsoft mb-2">
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
                    Conf {p.confidence}/5{p.starts ? ` · ${formatCardDate(feed?.date)} ${p.starts}` : ""}
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
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
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

  const editions = (feed?.editions || (feed?.slot ? [feed.slot] : []))
    .map((s) => SLOT_LABEL[s] || s)
    .join(" · ");
  const cardDate = formatCardDate(feed?.date);
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
  const storyByPick = new Map<string, string | null>();
  const yourBookByPick = new Map<string, BestPrice>();
  for (const p of feed?.picks || []) {
    const key = `${p.game}|${p.play}`;
    const bg = findBoardGame(p, boardGames);
    if (bg) {
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
    }
  }

  // Steam section: the same strict selection as the alert emails — the
  // pick's own game, market and side only, collapsed to one line per
  // game+market+side across books. (The old per-pick fuzzy matcher listed
  // both teams at every book and once attached a Texas Tech CFB move to
  // Wild @ Canucks via the substring "wild" in "Wildcats".)
  const cardSteam = selectCardSteamMoves(feed?.picks || [], boardGames, boardMovers);

  // Yesterday strip + confidence calibration (same track-record source
  // as /track-record; renders nothing when there's nothing graded).
  let yesterdayGlance: Awaited<ReturnType<typeof getYesterdayGlance>> = null;
  let confCalibration: Awaited<ReturnType<typeof getConfidenceCalibration>> = [];
  try {
    [yesterdayGlance, confCalibration] = await Promise.all([
      getYesterdayGlance(),
      getConfidenceCalibration(),
    ]);
  } catch {
    /* record unavailable — card renders without the strip */
  }
  const conf3 = confCalibration.find((c) => c.conf === "3");

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
          What confidence means
        </summary>
        <div className="text-xs text-muted mt-2 space-y-1 max-w-xl">
          <p>
            Every play is graded 1–5. <strong className="text-paper">Conf 3</strong> is our
            workhorse grade — a real quantified edge with a confirmed driver behind it.
            <strong className="text-paper"> Conf 4</strong> is star-quality only, published
            rarely. <strong className="text-paper">Conf 5</strong> is the highest bar we
            have — it has never been awarded.
          </p>
          {conf3 && conf3.stat.w + conf3.stat.l >= 10 && (
            <p>
              Lifetime on the recorded card, Conf 3 is {formatRecord(conf3.stat)}
              {conf3.stat.pct !== null && <> ({conf3.stat.pct.toFixed(1)}%)</>} across{" "}
              {conf3.stat.w + conf3.stat.l + conf3.stat.p} graded picks. Full breakdown on
              the <Link href="/track-record" className="underline hover:text-gold">record page</Link>.
            </p>
          )}
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

          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <p className="text-xs font-bold uppercase tracking-widest text-gold">
              {sortByTime
                ? "Ordered by start time — badges keep the confidence rank"
                : "Ranked by confidence — #1 is our top play"}
            </p>
            <span className="flex items-center gap-1 text-xs font-bold">
              <Link
                href="/picks"
                className={`px-2.5 py-1 rounded-full border ${sortByTime ? "border-line text-muted hover:text-gold" : "border-gold/60 bg-gold/10 text-gold"}`}
              >
                Confidence
              </Link>
              <Link
                href="/picks?sort=time"
                className={`px-2.5 py-1 rounded-full border ${sortByTime ? "border-gold/60 bg-gold/10 text-gold" : "border-line text-muted hover:text-gold"}`}
              >
                🕐 Start time
              </Link>
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 mb-8">
            {sortedPicks.map(({ p, status, rank }) => {
              const key = `${p.game}|${p.play}`;
              return (
                <PickCard
                  key={key}
                  p={p}
                  index={rank}
                  status={status}
                  best={bestByPick.get(key) || null}
                  movedNote={movedByPick.get(key) || null}
                  lineStory={storyByPick.get(key) || null}
                  winProb={modelWinProb(p)}
                  yourBook={yourBookByPick.get(key) || null}
                  initiallyTailed={tailedSet.has(key)}
                  cardDate={cardDate}
                />
              );
            })}
          </div>

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
                        <p className="text-sm text-goldsoft">
                          {prop.play} <span className="text-muted">{prop.price}</span>
                        </p>
                        <p className="text-xs text-muted">
                          Conf {prop.confidence}/5
                          {prop.starts ? ` · 🕐 ${prop.starts}` : ""}
                        </p>
                        {prop.reasoning && (
                          <p className="text-xs text-muted mt-1">{prop.reasoning}</p>
                        )}
                      </div>
                      <TailButton
                        game={prop.game}
                        play={prop.play}
                        price={prop.price}
                        initiallyTailed={tailedSet.has(key)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 mt-4">
            <div className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-widest text-gold">
                  Teaser of the Day
                </span>
                {feed.teaser && (
                  <span className="text-xs text-muted">Conf {feed.teaser.confidence}/5</span>
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
                      confidence={feed.teaser.confidence}
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
                {feed.parlay && (
                  <span className="text-xs text-muted">Conf {feed.parlay.confidence}/5</span>
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
                      confidence={feed.parlay.confidence}
                      dateLabel={cardDate}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted">No parlay today — nothing cleared the bar.</p>
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
                  Settles {feed.lookaheads.teaser.target_date} · Conf {feed.lookaheads.teaser.confidence}/5
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
                    <p className="text-xs text-muted">Conf {pick.confidence}/5{typeof pick.edge_cents === "number" ? ` · ~${pick.edge_cents}¢ edge` : ""}</p>
                    {pick.reasoning && (
                      <p className="text-xs text-muted mt-1">{pick.reasoning}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <p className="text-xs text-muted mt-8">Analysis for entertainment purposes — not financial advice.</p>
    </div>
  );
}
