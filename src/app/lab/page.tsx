import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";
import { getPicksFeed } from "@/lib/picks";
import LabBuilder from "./LabBuilder";
import LabPromo from "./LabPromo";
import LabTabs from "./LabTabs";
import CheatsheetBuilder from "./CheatsheetBuilder";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const session = await auth();
  const email = session?.user?.email || null;
  const sub = await getSubscription(email || "");
  const allowed = await hasAccess(email, sub);
  const feed = await getPicksFeed();
  const legCount = (feed?.picks.length || 0) + (feed?.props?.length || 0);

  if (!allowed) {
    return (
      <div className="max-w-3xl mx-auto px-4">
        <div className="text-center pt-8 pb-4">
          <h1 className="font-display text-4xl mb-2">
            PARLAY <span className="gold-text">LAB</span> 🔒
          </h1>
          <p className="text-muted text-sm mb-1">
            {session?.user
              ? `Signed in as ${email} — no active subscription.`
              : "You set the shape — the Lab finds the edges."}
          </p>
        </div>
        <LabPromo legCount={legCount} />
        <div className="text-center py-6">
          {session?.user ? (
            <span className="inline-block px-8 py-3 rounded-full border border-gold/40 text-gold/70 font-bold text-xs tracking-[0.25em]">
              BETA — INVITE ONLY
            </span>
          ) : (
            <Link
              href="/signin"
              className="btn-gold px-8 py-3 inline-block font-bold"
            >
              Sign in to unlock
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="font-display text-4xl mb-1">
        PARLAY <span className="gold-text">LAB</span>
      </h1>
      <p className="text-muted text-sm mb-6">
        Build your own ticket from today&apos;s edges — props always eligible
        for parlays. Or flip to 📋 Cheatsheet: today&apos;s props ranked by how
        often they&apos;ve actually cashed. 🕐 Pool refreshes with the 7am card.
      </p>
      {!feed || legCount === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg mb-2">Today&apos;s edge pool is being prepared.</p>
          <p className="text-sm text-muted">Check back shortly — it posts with the 7am brief.</p>
        </div>
      ) : (
        <LabTabs
          lab={<LabBuilder picks={feed.picks} props={feed.props || []} />}
          sheet={<CheatsheetBuilder />}
        />
      )}
      <p className="text-xs text-muted mt-8">
        Analysis for entertainment purposes — not financial advice.
      </p>
    </div>
  );
}
