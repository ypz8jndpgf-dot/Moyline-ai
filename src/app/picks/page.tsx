import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";
import { getPicksFeed } from "@/lib/picks";

export const dynamic = "force-dynamic";

const SLOT_LABEL: Record<string, string> = {
  "7am": "Morning",
  "11am": "Midday",
  "6pm": "Evening",
  sat2pm: "Saturday",
};

export default async function PicksPage() {
  const session = await auth();
  const email = session?.user?.email || null;
  const sub = await getSubscription(email || "");
  const allowed = hasAccess(email, sub);

  if (!session?.user) {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <h1 className="font-display text-4xl mb-4">PRO PICKS <span className="gold-text">🔒</span></h1>
        <p className="text-muted mb-6">Sign in to see if you have access to tonight&apos;s card.</p>
        <Link href="/signin" className="btn-gold px-8 py-3 inline-block">Sign in</Link>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <h1 className="font-display text-4xl mb-4">PRO PICKS <span className="gold-text">🔒</span></h1>
        <p className="text-muted mb-2">Tonight&apos;s card is locked.</p>
        <p className="text-muted mb-6">Signed in as <span className="text-paper">{email}</span> — no active subscription.</p>
        <Link href="/pricing" className="btn-gold px-8 py-3 inline-block">Unlock with Pro</Link>
      </div>
    );
  }

  const feed = await getPicksFeed();
  const slotLabel = feed ? SLOT_LABEL[feed.slot] || feed.slot : null;

  return (
    <div>
      <h1 className="font-display text-4xl mb-1">TONIGHT&apos;S <span className="gold-text">CARD</span></h1>
      <p className="text-muted text-sm mb-6">
        Pro members only · {email} · 🕐 Card refreshes daily each morning
        {slotLabel && <> · {slotLabel} edition</>}
      </p>

      {!feed || feed.picks.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg mb-2">Today&apos;s card is being prepared.</p>
          <p className="text-sm text-muted">Check back shortly — picks post with the morning brief.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {feed.picks.map((p, i) => (
              <div key={i} className="card card-glow p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-widest text-gold">
                    #{i + 1} {p.star && "★"}
                  </span>
                  <span className="text-xs text-muted">Conf {p.confidence}/5</span>
                </div>
                <h3 className="font-display text-xl mb-1">{p.game}</h3>
                <p className="text-lg font-bold text-goldsoft mb-2">
                  {p.play} <span className="text-sm text-muted">{p.price}</span>
                </p>
                {p.reasoning && <p className="text-sm text-muted">{p.reasoning}</p>}
              </div>
            ))}
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
        </>
      )}
      <p className="text-xs text-muted mt-8">Analysis for entertainment purposes — not financial advice.</p>
    </div>
  );
}
