import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";

export const dynamic = "force-dynamic";

// Demo picks shown to subscribers. In production these come from your
// nightly model/brief pipeline via /api/track-record or a picks store.
const PRO_PICKS = [
  {
    game: "Bruins @ Jets (NHL)",
    play: "Bruins ML",
    price: "+105 (BetMGM)",
    confidence: 4,
    star: true,
    reasoning: "Skinner confirmed for Winnipeg with Hellebuyck out; Boston the better team at plus money.",
  },
  {
    game: "Wings @ Valkyries (WNBA G3)",
    play: "Wings +8.5",
    price: "-118 (DraftKings)",
    confidence: 4,
    star: false,
    reasoning: "DK hanging a full point better than the market (-7.5/-8 elsewhere); Dallas has covered 4 of 5 vs Golden State.",
  },
];

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

  return (
    <div>
      <h1 className="font-display text-4xl mb-1">TONIGHT&apos;S <span className="gold-text">CARD</span></h1>
      <p className="text-muted text-sm mb-6">Pro members only · {email}</p>
      <div className="grid gap-4 md:grid-cols-2">
        {PRO_PICKS.map((p, i) => (
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
            <p className="text-sm text-muted">{p.reasoning}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-8">Analysis for entertainment purposes — not financial advice.</p>
    </div>
  );
}
