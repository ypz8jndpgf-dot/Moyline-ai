import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";
import { getPicksFeed, PicksFeed, FeedPick } from "@/lib/picks";
import { getOdds, getOpenings } from "@/lib/odds";
import { buildBoard, MoverVM } from "@/lib/board";
import { findBoardGame, bestPriceForPick, badgeBeatsPlay, steamForGame, BestPrice } from "@/lib/card-utils";
import { readTails } from "@/lib/tails";
import TailButton from "./TailButton";
import MarketingPaywall from "@/components/MarketingPaywall";

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
  initiallyTailed,
  cardDate,
}: {
  p: FeedPick;
  index: number;
  status: Status;
  best: BestPrice;
  initiallyTailed: boolean;
  cardDate: string;
}) {
  return (
    <div className="card card-glow p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold uppercase tracking-widest text-gold">
          #{index + 1} {p.star && "★"}
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
      {p.reasoning && <p className="text-sm text-muted">{p.reasoning}</p>}
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
      <div className="mt-3">
        <TailButton game={p.game} play={p.play} price={p.price} initiallyTailed={initiallyTailed} />
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

export default async function PicksPage() {
  const session = await auth();
  const email = session?.user?.email || null;
  const sub = await getSubscription(email || "");
  const allowed = await hasAccess(email, sub);
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

  const bestByPick = new Map<string, BestPrice>();
  const steamByPick = new Map<string, MoverVM[]>();
  for (const p of feed?.picks || []) {
    const key = `${p.game}|${p.play}`;
    const bg = findBoardGame(p, boardGames);
    if (bg) {
      const bp = bestPriceForPick(p, bg);
      // Only show the badge when the live price is at least as good as the
      // locked-in play price — never contradict the card after line movement.
      bestByPick.set(key, bp && badgeBeatsPlay(p, bp) ? bp : null);
      const steam = steamForGame(bg, boardMovers);
      if (steam.length > 0) steamByPick.set(key, steam);
    }
  }

  // Member's tailed picks (for initial button state).
  const tails = email ? await readTails(email) : [];
  const tailedSet = new Set(tails.map((t) => `${t.game}|${t.play}`));

  // All picks in one flat list, sorted by confidence then edge (highest first).
  const sortedPicks = (feed?.picks || [])
    .map((p) => {
      const mins = parseStart(p.starts);
      return { p, status: statusFor(mins, nowMins), mins };
    })
    .sort((a, b) => {
      const confDiff = (b.p.confidence || 0) - (a.p.confidence || 0);
      if (confDiff !== 0) return confDiff;
      const edgeDiff = (b.p.edge_cents || 0) - (a.p.edge_cents || 0);
      if (edgeDiff !== 0) return edgeDiff;
      return (a.mins ?? 9999) - (b.mins ?? 9999);
    });

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

      {!feed || feed.picks.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg mb-2">Today&apos;s card is being prepared.</p>
          <p className="text-sm text-muted">Check back shortly — picks post with the 7am brief.</p>
        </div>
      ) : (
        <>
          {steamByPick.size > 0 && (
            <div className="card p-5 mb-8 border-gold/40">
              <h2 className="font-display text-xl mb-3">
                🔥 Steam on your card
              </h2>
              <ul className="text-sm space-y-2">
                {[...steamByPick.entries()].map(([key, movers]) => (
                  <li key={key}>
                    <span className="font-bold">{key.split("|")[0]}</span>
                    <span className="text-muted"> — </span>
                    {movers.map((m, j) => (
                      <span key={j} className="text-paper">
                        {m.label} <span className="text-muted">({m.detail})</span>
                        {j < movers.length - 1 && "; "}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 mb-8">
            {sortedPicks.map(({ p, status }, i) => {
              const key = `${p.game}|${p.play}`;
              return (
                <PickCard
                  key={key}
                  p={p}
                  index={i}
                  status={status}
                  best={bestByPick.get(key) || null}
                  initiallyTailed={tailedSet.has(key)}
                  cardDate={cardDate}
                />
              );
            })}
          </div>

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
