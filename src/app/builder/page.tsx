import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";
import { getPicksFeed } from "@/lib/picks";
import { getOdds } from "@/lib/odds";
import { buildBoard, GameVM } from "@/lib/board";
import TicketBuilder from "./TicketBuilder";
import BuilderPromo from "./BuilderPromo";

export const dynamic = "force-dynamic";

/** Convert board games into selectable legs (best price per market). */
function boardGamesToLegs(games: GameVM[]) {
  const legs: { game: string; play: string; price: string; confidence: number; market: "spread" | "total" | "ml"; line?: string }[] = [];
  for (const g of games) {
    const label = `${g.away} @ ${g.home} (${g.sportLabel})`;
    // Find best cell per market across books
    const best = (get: (b: any) => any) => {
      let b: any = null;
      for (const book of g.books) {
        const c = get(book);
        if (c && (!b || c.best)) b = c;
      }
      return b || get(g.books[0]);
    };
    const push = (play: string, cell: any, market: "spread" | "total" | "ml", line?: string) => {
      if (!cell) return;
      legs.push({
        game: label,
        play,
        price: cell.display.match(/\(([^)]+)\)/)?.[1] || "",
        confidence: 0, // unrated — AI flags these
        market,
        line,
      });
    };
    const sA = best((b) => b.spreadAway);
    const sH = best((b) => b.spreadHome);
    const oU = best((b) => b.totalOver);
    const uU = best((b) => b.totalUnder);
    const mA = best((b) => b.mlAway);
    const mH = best((b) => b.mlHome);
    if (sA) push(`${g.away} ${sA.display.split(" ")[0]}`, sA, "spread", sA.display.split(" ")[0]);
    if (sH) push(`${g.home} ${sH.display.split(" ")[0]}`, sH, "spread", sH.display.split(" ")[0]);
    if (oU) push(`Over ${oU.display.split(" ")[0]}`, oU, "total", oU.display.split(" ")[0]);
    if (uU) push(`Under ${uU.display.split(" ")[0]}`, uU, "total", uU.display.split(" ")[0]);
    if (mA) push(`${g.away} ML`, mA, "ml");
    if (mH) push(`${g.home} ML`, mH, "ml");
  }
  return legs;
}

export default async function BuilderPage() {
  const session = await auth();
  const email = session?.user?.email || null;
  const sub = await getSubscription(email || "");
  const allowed = hasAccess(email, sub);
  const feed = await getPicksFeed();
  const [oddsResult, openings] = await Promise.all([getOdds(), (await import("@/lib/odds")).getOpenings()]);
  const { games: boardGames } = buildBoard(oddsResult.events, openings);
  const boardLegs = boardGamesToLegs(boardGames);
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
          boardLegs={boardLegs}
        />
      )}
      <p className="text-xs text-muted mt-8 text-center">
        Analysis for entertainment purposes — not financial advice.
      </p>
    </div>
  );
}
