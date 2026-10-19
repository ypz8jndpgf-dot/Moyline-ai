import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess, getTrackRecord } from "@/lib/store";
import { readTails } from "@/lib/tails";

export const dynamic = "force-dynamic";

const norm = (s: string) =>
  s.toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Match a tailed pick to its graded track-record entry, if graded. */
function gradeTail(
  tail: { game: string; play: string; date: string },
  picks: { game: string; play: string; date: string; result: string; final?: string }[]
) {
  const tg = norm(tail.game);
  const tp = norm(tail.play);
  return (
    picks.find((p) => {
      if (p.date !== tail.date) return false;
      if (norm(p.play) !== tp) return false;
      const pg = norm(p.game);
      // every word of the tail's game must appear in the record's game (or vice versa)
      const tw = tg.split(" ").filter((w) => w.length > 2);
      const pw = pg.split(" ").filter((w) => w.length > 2);
      return tw.every((w) => pg.includes(w)) || pw.every((w) => tg.includes(w));
    }) || null
  );
}

export default async function MyTailsPage() {
  const session = await auth();
  const email = session?.user?.email || null;
  const sub = await getSubscription(email || "");
  const allowed = await hasAccess(email, sub);

  if (!allowed) {
    return (
      <div className="max-w-xl mx-auto text-center py-10">
        <h1 className="font-display text-4xl mb-4">MY TAILS</h1>
        <p className="text-muted mb-6">Members can tap “Tailed it” on any pick and track their own record here.</p>
        {session?.user ? (
          <span className="inline-block px-8 py-3 rounded-full border border-gold/40 text-gold/70 font-bold text-xs tracking-[0.25em]">
            BETA — INVITE ONLY
          </span>
        ) : (
          <Link href="/signin" className="btn-gold px-8 py-3 inline-block">
            Sign in
          </Link>
        )}
      </div>
    );
  }

  const tails = await readTails(email!);
  const rec = await getTrackRecord();
  const graded = tails.map((t) => ({ tail: t, result: gradeTail(t, rec.picks as never[]) }));

  const w = graded.filter((g) => g.result?.result === "Win").length;
  const l = graded.filter((g) => g.result?.result === "Loss").length;
  const p = graded.filter((g) => g.result?.result === "Push").length;
  const pending = graded.length - w - l - p;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-display text-4xl mb-1">
        MY <span className="gold-text">TAILS</span>
      </h1>
      <p className="text-muted text-sm mb-6">
        {email} · {w}-{l}-{p}
        {pending > 0 && <span className="text-muted"> · {pending} pending</span>}
      </p>

      {tails.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg mb-2">Nothing tailed yet.</p>
          <p className="text-sm text-muted mb-6">
            Tap “Tailed it” on any card pick and it lands here with your record.
          </p>
          <Link href="/picks" className="btn-gold px-6 py-2 inline-block">
            View today&apos;s card
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {graded
            .slice()
            .reverse()
            .map(({ tail, result }, i) => (
              <div key={i} className="card p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-bold">{tail.game}</p>
                  <p className="text-sm text-goldsoft">
                    {tail.play} <span className="text-muted">{tail.price}</span>
                  </p>
                  <p className="text-xs text-muted">{tail.date}</p>
                  {result?.final && <p className="text-xs text-muted mt-1">{result.final}</p>}
                </div>
                <span
                  className={`text-sm font-bold px-3 py-1 rounded ${
                    result?.result === "Win"
                      ? "text-up"
                      : result?.result === "Loss"
                        ? "text-down"
                        : "text-muted"
                  }`}
                >
                  {result ? result.result : "Pending"}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
