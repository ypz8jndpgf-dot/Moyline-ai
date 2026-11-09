import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";
import { getPicksFeed, type FeedPick } from "@/lib/picks";
import { pickWinEdge } from "@/lib/winprob";
import PickStatusBanner from "@/components/PickStatusBanner";

export const dynamic = "force-dynamic";

function BackpageCard({ p }: { p: FeedPick }) {
  const winEdge = pickWinEdge(p);
  const voided = p.status === "voided";
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1">
        {winEdge && !voided ? (
          <span className="text-xs font-bold uppercase tracking-widest text-muted">
            {winEdge}
          </span>
        ) : (
          <span />
        )}
        {p.starts && <span className="text-xs text-muted">{p.starts}</span>}
      </div>
      <PickStatusBanner p={p} className="mb-2" />
      <h3 className="font-display text-lg">{p.game}</h3>
      <p
        className={`text-md font-bold text-goldsoft ${voided ? "line-through opacity-50" : ""}`}
      >
        {p.play} <span className="text-sm text-muted">{p.price}</span>
      </p>
      {p.reasoning && <p className="text-sm text-muted mt-2">{p.reasoning}</p>}
    </div>
  );
}

export default async function Backpage() {
  const session = await auth();
  const email = session?.user?.email || null;
  const sub = await getSubscription(email || "");
  const allowed = await hasAccess(email, sub);
  const feed = await getPicksFeed();
  const backpage = feed?.backpage || [];

  if (!allowed) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-4xl mb-2">
          UNDER<span className="gold-text">CARD</span> 🔒
        </h1>
        <p className="text-muted text-sm mb-6 max-w-md mx-auto">
          {session?.user
            ? `Signed in as ${email} — no active subscription.`
            : "Sign in to see if you have access."}
          <br />
          The next tier of plays — genuine-edge leans that didn't clear the
          main card's bar.
        </p>
        <Link
          href="/signin"
          className="btn-gold px-6 py-3 rounded font-bold inline-block"
        >
          Sign in
        </Link>
        {session?.user && (
          <div className="mt-4">
            <span className="inline-block px-6 py-2.5 rounded-full border border-gold/40 text-gold/70 font-bold text-xs tracking-[0.25em]">
              BETA — INVITE ONLY
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="font-display text-3xl sm:text-4xl mb-1">
        UNDER<span className="gold-text">CARD</span>
      </h1>
      <p className="text-sm text-muted mb-1">
        Pro members only{email ? ` · ${email}` : ""}
      </p>
      <p className="text-xs text-muted mb-6">
        The next tier — leans with genuine edge that didn't clear the main
        card's bar. Never forced; thin days run short.
      </p>

      {backpage.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-muted text-sm">
            No backpage leans today — nothing cleared the edge bar.
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
