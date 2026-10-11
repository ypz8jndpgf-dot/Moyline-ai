import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";
import { getPicksFeed, type FeedPick } from "@/lib/picks";

export const dynamic = "force-dynamic";

function BackpageCard({ p }: { p: FeedPick }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold uppercase tracking-widest text-muted">
          Conf {p.confidence}/5
        </span>
        {p.starts && <span className="text-xs text-muted">{p.starts}</span>}
      </div>
      <h3 className="font-display text-lg">{p.game}</h3>
      <p className="text-md font-bold text-goldsoft">
        {p.play} <span className="text-sm text-muted">{p.price}</span>
      </p>
      {p.reasoning && <p className="text-sm text-muted mt-2">{p.reasoning}</p>}
      {p.edge_cents != null && (
        <p className="text-xs text-muted mt-1">Edge: ~{p.edge_cents}¢ vs fair</p>
      )}
    </div>
  );
}

export default async function Backpage() {
  const session = await auth();
  const email = session?.user?.email || null;
  const sub = await getSubscription(email || "");
  const allowed = hasAccess(email, sub);
  const feed = await getPicksFeed();
  const backpage = feed?.backpage || [];

  if (!allowed) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-4xl mb-2">
          BACK<span className="gold-text">PAGE</span> 🔒
        </h1>
        <p className="text-muted text-sm mb-6 max-w-md mx-auto">
          {session?.user
            ? `Signed in as ${email} — no active subscription.`
            : "Sign in to see if you have access."}
          <br />
          The next tier of plays — confidence-3 leans with real edge that didn't
          clear the main card's bar.
        </p>
        <Link
          href={session?.user ? "/pricing" : "/signin"}
          className="btn-gold px-6 py-3 rounded font-bold inline-block"
        >
          {session?.user ? "Unlock with Pro" : "Sign in"}
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="font-display text-3xl sm:text-4xl mb-1">
        BACK<span className="gold-text">PAGE</span>
      </h1>
      <p className="text-sm text-muted mb-1">
        Pro members only{email ? ` · ${email}` : ""}
      </p>
      <p className="text-xs text-muted mb-6">
        The next tier — confidence-3 leans with genuine edge that didn't clear
        the main card's conf-4 bar. Never forced; thin days run short.
      </p>

      {backpage.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-muted text-sm">
            No backpage leans today — nothing at confidence 3 cleared the edge bar.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {backpage.map((p, i) => (
            <BackpageCard key={`${p.game}-${p.play}-${i}`} p={p} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted mt-8 text-center">
        Analysis for entertainment purposes — not financial advice.
      </p>
    </div>
  );
}
