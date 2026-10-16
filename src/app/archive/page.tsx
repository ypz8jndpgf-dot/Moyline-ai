import type { Metadata } from "next";
import Link from "next/link";
import { getArchive, sportFromGame, type ArchivePick } from "@/lib/picks";
import ArchiveClient from "./archive-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Free Sports Picks Archive — MoyLine AI",
  description:
    "Browse MoyLine AI's archive of free sports picks with dates and verified win/loss results. See the track record before you go Pro.",
  openGraph: {
    title: "Free Sports Picks Archive — MoyLine AI",
    description:
      "Verified free sports picks with dates and W/L results. See the track record.",
    type: "website",
  },
};

type DayGroup = {
  date: string;
  label: string;
  picks: ArchivePick[];
  wins: number;
  losses: number;
  pushes: number;
};

function groupByDate(picks: ArchivePick[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const p of picks) {
    let g = map.get(p.date);
    if (!g) {
      g = { date: p.date, label: formatDate(p.date), picks: [], wins: 0, losses: 0, pushes: 0 };
      map.set(p.date, g);
    }
    g.picks.push(p);
    if (p.result === "win") g.wins++;
    else if (p.result === "loss") g.losses++;
    else g.pushes++;
  }
  // Newest date first.
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function ArchivePage() {
  const picks = await getArchive();
  const groups = groupByDate(picks);

  const totalWins = picks.filter((p) => p.result === "win").length;
  const totalLosses = picks.filter((p) => p.result === "loss").length;
  const totalPushes = picks.filter((p) => p.result === "push").length;
  const decided = totalWins + totalLosses;
  const winPct = decided > 0 ? ((totalWins / decided) * 100).toFixed(1) : "—";

  const sports = [...new Set(picks.map((p) => (p.sport || sportFromGame(p.game)).toUpperCase()))].sort();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <p className="text-xs font-bold uppercase tracking-[0.3em] text-gold mb-2">
        Transparent track record
      </p>
      <h1 className="font-display text-4xl sm:text-5xl leading-tight mb-3">
        FREE PICKS <span className="gold-text">ARCHIVE</span>
      </h1>
      <p className="text-muted max-w-2xl mb-6">
        Every free pick we&apos;ve published, with the date it ran and the
        verified result. No cherry-picking — wins and losses, all here.
      </p>

      {picks.length > 0 ? (
        <>
          <div className="card card-glow p-5 mb-8 flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <div className="font-display text-3xl">
                <span className="text-up">{totalWins}</span>
                <span className="text-muted">-</span>
                <span className="text-down">{totalLosses}</span>
                {totalPushes > 0 && (
                  <span className="text-muted">-{totalPushes}</span>
                )}
              </div>
              <div className="text-xs text-muted uppercase tracking-widest mt-1">
                Archive record
              </div>
            </div>
            <div>
              <div className="font-display text-3xl gold-text">{winPct}%</div>
              <div className="text-xs text-muted uppercase tracking-widest mt-1">
                Win rate
              </div>
            </div>
            <div>
              <div className="font-display text-3xl">{picks.length}</div>
              <div className="text-xs text-muted uppercase tracking-widest mt-1">
                Picks tracked
              </div>
            </div>
          </div>

          <ArchiveClient groups={groups} sports={sports} />
        </>
      ) : (
        <div className="card p-8 text-center">
          <p className="text-muted mb-2">
            The archive is still filling up — graded picks land here daily after
            the morning results run.
          </p>
          <p className="text-sm text-muted">
            Check back tomorrow, or see today&apos;s card.
          </p>
        </div>
      )}

      <div className="card gold-border p-6 mt-10 text-center">
        <h2 className="font-display text-2xl mb-2">
          Want the <span className="gold-text">full card</span> every morning?
        </h2>
        <p className="text-muted text-sm mb-4 max-w-xl mx-auto">
          The archive shows our free picks. Pro members get the complete grid —
          every quantified edge, the ★ play, the Parlay Lab, and steam alerts —
          delivered before the lines move.
        </p>
        <Link href="/pricing" className="inline-block px-6 py-3 btn-gold text-sm">
          Go Pro
        </Link>
      </div>
    </div>
  );
}
