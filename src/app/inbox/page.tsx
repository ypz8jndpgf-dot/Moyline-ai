import Link from "next/link";
import { auth } from "@/lib/auth";
import { getSubscription, hasAccess } from "@/lib/store";
import { getPushInbox, PUSH_KIND_LABELS } from "@/lib/push-inbox";

export const dynamic = "force-dynamic";
export const metadata = { title: "What Did I Miss | MoyLine AI" };

/** "Fri, Nov 13 · 7:02 AM ET" — the member's alerts are ET-dated news. */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const time = d
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    })
    .replace(" ", "")
    .toLowerCase();
  return `${date} · ${time} ET`;
}

/**
 * "What did I miss" (optimization #74): the member's own push inbox —
 * every alert actually sent to them over the last 7 days, logged at the
 * send paths in lib/push.ts. Member-gated exactly like /my-tails.
 */
export default async function InboxPage() {
  const session = await auth();
  const email = session?.user?.email || null;
  const sub = await getSubscription(email || "");
  const allowed = await hasAccess(email, sub);

  if (!allowed) {
    return (
      <div className="max-w-xl mx-auto text-center py-10">
        <h1 className="font-display text-4xl mb-4">WHAT DID I MISS</h1>
        <p className="text-muted mb-6">
          Members get a kept copy of every alert we send them — card-live, new picks, the ★ alarm, tail alerts — right here.
        </p>
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

  const entries = await getPushInbox(email!, 7);

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-display text-4xl mb-1">
        WHAT DID <span className="gold-text">I MISS</span>
      </h1>
      <p className="text-muted text-sm mb-6">
        {email} · every alert we&apos;ve sent you in the last 7 days — kept here even if the notification got swiped away.
      </p>

      {entries.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg mb-2">Nothing yet.</p>
          <p className="text-sm text-muted mb-6">
            When we send you a push — a live card, a new pick, a tail alert — a copy lands here. Make sure the 🔔 bell on the Picks page is on so there&apos;s something to miss.
          </p>
          <Link href="/picks" className="btn-gold px-6 py-2 inline-block">
            View today&apos;s card
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {entries.map((e, i) => (
            <div key={`${e.at}-${i}`} className="card p-4">
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gold bg-gold/10 border border-gold/30 rounded px-2 py-0.5">
                  {PUSH_KIND_LABELS[e.kind] || "📣 Announcement"}
                </span>
                <span className="text-[11px] text-muted whitespace-nowrap">{fmtWhen(e.at)}</span>
              </div>
              <p className="font-bold text-sm">{e.title}</p>
              <p className="text-sm text-muted mt-0.5">{e.body}</p>
              <Link href={e.url || "/picks"} className="text-xs font-bold text-gold hover:text-goldsoft mt-2 inline-block">
                View →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
