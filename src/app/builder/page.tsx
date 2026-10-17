import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";
import { getPicksFeed } from "@/lib/picks";
import TicketBuilder from "./TicketBuilder";
import BuilderPromo from "./BuilderPromo";

export const dynamic = "force-dynamic";

export default async function BuilderPage() {
  const session = await auth();
  const email = session?.user?.email || null;
  const sub = await getSubscription(email || "");
  const allowed = hasAccess(email, sub);
  const feed = await getPicksFeed();
  const legCount =
    (feed?.picks.length || 0) + (feed?.props?.length || 0) + (feed?.backpage?.length || 0);

  if (!allowed) {
    return (
      <div className="max-w-3xl mx-auto px-4">
        <div className="text-center pt-8 pb-4">
          <h1 className="font-display text-4xl mb-2">
            TICKET <span className="gold-text">BUILDER</span> 🔒
          </h1>
          <p className="text-muted text-sm mb-1">
            {session?.user
              ? `Signed in as ${email} — no active subscription.`
              : "Build your own parlays. Get an AI verdict."}
          </p>
        </div>
        <BuilderPromo legCount={legCount} />
        <div className="text-center py-6">
          <Link
            href={session?.user ? "/pricing" : "/signin"}
            className="btn-gold px-8 py-3 inline-block font-bold"
          >
            {session?.user ? "Unlock with Pro" : "Sign in to unlock"}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <h1 className="font-display text-3xl sm:text-4xl mb-1">
        TICKET <span className="gold-text">BUILDER</span>
      </h1>
      <p className="text-muted text-sm mb-6">
        Pick your legs — the AI grades your ticket, flags the weak spots, and
        suggests upgrades.
      </p>
      {!feed || legCount === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg mb-2">Today&apos;s leg pool is being prepared.</p>
          <p className="text-sm text-muted">Check back shortly — it posts with the 7am brief.</p>
        </div>
      ) : (
        <TicketBuilder
          picks={feed.picks}
          props={feed.props || []}
          backpage={feed.backpage || []}
        />
      )}
      <p className="text-xs text-muted mt-8 text-center">
        Analysis for entertainment purposes — not financial advice.
      </p>
    </div>
  );
}
