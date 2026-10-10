import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";
import { getPicksFeed, PicksFeed, FeedPick } from "@/lib/picks";
import { getOdds, getOpenings } from "@/lib/odds";
import { buildBoard, MoverVM } from "@/lib/board";
import { findBoardGame, bestPriceForPick, steamForGame, BestPrice } from "@/lib/card-utils";
import { readTails } from "@/lib/tails";
import TailButton from "./TailButton";

export const dynamic = "force-dynamic";

const SLOT_LABEL: Record<string, string> = {
  "7am": "Morning",
  "11am": "Midday",
  "6pm": "Evening",
  sat2pm: "Saturday",
  cfbdeepdive: "Evening Deep Dive",
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

type Window = "Morning" | "Afternoon" | "Evening" | "Night" | "More plays";

function windowFor(mins: number | null): Window {
  if (mins === null) return "More plays";
  if (mins < 12 * 60) return "Morning";
  if (mins < 18 * 60) return "Afternoon";
  if (mins < 22 * 60) return "Evening";
  return "Night";
}

const WINDOW_ORDER: Window[] = ["Morning", "Afternoon", "Evening", "Night", "More plays"];

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

function PickCard({
  p,
  index,
  status,
  best,
  initiallyTailed,
}: {
  p: FeedPick;
  index: number;
  status: Status;
  best: BestPrice;
  initiallyTailed: boolean;
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
      {p.starts && <p className="text-xs text-muted mb-1">🕐 {p.starts}</p>}
      <p className="text-lg font-bold text-goldsoft mb-1">
        {p.play} <span className="text-sm text-muted">{p.price}</span>
      </p>
      {best && (
        <p className="text-xs mb-2">
          <span className="inline-block bg-gold/15 text-gold font-bold px-2 py-0.5 rounded">
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
            {freePick.starts && <p className="text-xs text-muted mb-1">🕐 {freePick.starts}</p>}
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
                    Conf {p.confidence}/5{p.starts ? ` · ${p.starts}` : ""}
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
  const allowed = hasAccess(email, sub);
  const feed = await getPicksFeed();

  if (!allowed) {
    return (
      <PaywallPreview
        feed={feed}
        ctaHref={session?.user ? "/pricing" : "/signin"}
        ctaLabel={session?.user ? "Unlock with Pro" : "Sign in"}
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
      bestByPick.set(key, bestPriceForPick(p, bg));
      const steam = steamForGame(bg, boardMovers);
      if (steam.length > 0) steamByPick.set(key, steam);
    }
  }

  // Member's tailed picks (for initial button state).
  const tails = email ? await readTails(email) : [];
  const tailedSet = new Set(tails.map((t) => `${t.game}|${t.play}`));

  // Group picks by time window, sorted by start time within each window.
  const groups = new Map<Window, { p: FeedPick; status: Status; mins: number | null }[]>();
  for (const p of feed?.picks || []) {
    const mins = parseStart(p.starts);
    const w = windowFor(mins);
    const arr = groups.get(w) || [];
    arr.push({ p, status: statusFor(mins, nowMins), mins });
    groups.set(w, arr);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => (a.mins ?? 9999) - (b.mins ?? 9999));
  }
  let cardIndex = 0;

  return (
    <div>
      <h1 className="font-display text-4xl mb-1">
        TODAY&apos;S <span className="gold-text">CARD</span>
      </h1>
      <p className="text-muted text-sm mb-6">
        Pro members only · {email}
        {editions && <> · {editions} edition{editions.includes("·") ? "s" : ""}</>} ·{" "}
        <Link href="/my-tails" className="underline hover:text-gold">
          My tails ({tails.length})
        </Link>
      </p>

      {!feed || feed.picks.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg mb-2">Today&apos;s card is being prepared.</p>
          <p className="text-sm text-muted">Check back shortly — picks post with the morning brief.</p>
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

          {WINDOW_ORDER.filter((w) => (groups.get(w) || []).length > 0).map((w) => (
            <div key={w} className="mb-8">
              <h2 className="font-display text-2xl mb-4">
                {w === "More plays" ? "More plays" : `${w} window`}
                <span className="text-sm text-muted font-sans"> ({groups.get(w)!.length})</span>
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {groups.get(w)!.map(({ p, status }) => {
                  const key = `${p.game}|${p.play}`;
                  return (
                    <PickCard
                      key={key}
                      p={p}
                      index={cardIndex++}
                      status={status}
                      best={bestByPick.get(key) || null}
                      initiallyTailed={tailedSet.has(key)}
                    />
                  );
                })}
              </div>
            </div>
          ))}

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
        </>
      )}
      <p className="text-xs text-muted mt-8">Analysis for entertainment purposes — not financial advice.</p>
    </div>
  );
}
