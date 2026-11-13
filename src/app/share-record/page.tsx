import type { Metadata } from "next";
import Link from "next/link";
import { parseRecordShare, recordLabel, type RecordShareStats } from "@/lib/record-share";
import { formatUnits } from "@/lib/records";

export const dynamic = "force-dynamic";

/**
 * Public landing page for a member-shared tail record (optimization
 * #75). The record renders only from the signature-verified snapshot
 * the member's own /my-tails share action created (lib/record-share.ts)
 * — tampered or unsigned params show a generic page with no numbers.
 * Deliberately noindex, like /share: member word-of-mouth only.
 */

type Params = Record<string, string | string[] | undefined>;

function statsFrom(params: Params): RecordShareStats | null {
  return parseRecordShare((k) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) ?? null;
  });
}

function cardImagePath(params: Params): string {
  const qs = new URLSearchParams();
  for (const k of ["w", "l", "p", "u", "pr", "g", "s"]) {
    const v = params[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (s) qs.set(k, s);
  }
  return `/api/share-record?${qs.toString()}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Params>;
}): Promise<Metadata> {
  const params = await searchParams;
  const stats = statsFrom(params);
  const title = stats
    ? `My tails: ${recordLabel(stats)} · ${formatUnits(stats.units)} — MoyLine AI`
    : "My Tails — MoyLine AI";
  const description = stats
    ? `${stats.graded} graded tails at MoyLine AI · Every play graded & published at moylineai.com`
    : "Members track their own record on every pick they tail — graded & published at moylineai.com";
  const image = cardImagePath(params);
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function ShareRecordPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const stats = statsFrom(params);
  const winPct =
    stats && stats.w + stats.l > 0
      ? Math.round((stats.w / (stats.w + stats.l)) * 1000) / 10
      : null;

  return (
    <div className="max-w-xl mx-auto py-10">
      <div className="card card-glow p-6 sm:p-8">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-widest text-gold">
            My Tails · Member record
          </span>
          {winPct !== null && <span className="text-xs text-muted">{winPct}% winners</span>}
        </div>
        {stats ? (
          <>
            <p className="font-display text-5xl mb-2">
              {recordLabel(stats)}{" "}
              <span className={stats.units >= 0 ? "gold-text" : "text-down"}>
                {formatUnits(stats.units)}
              </span>
            </p>
            <p className="text-sm text-muted mb-6">
              {stats.graded} graded tail{stats.graded === 1 ? "" : "s"}
              {stats.priced < stats.graded &&
                ` · units on ${stats.priced} of ${stats.graded} graded`}
              {stats.priced >= stats.graded && " · flat 1u a tail, at the prices tailed"}.
              Shared by a MoyLine AI member — every tail is a published card pick, graded
              against the same public track record as everything else we post.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted mb-6">
            Members track their own record on every pick they tail. Our desk grinds every
            slate — spreads, totals, props, injuries, line movement — and every play we
            publish is graded and posted, win or lose.
          </p>
        )}
        <Link href="/picks" className="btn-gold px-6 py-3 inline-block">
          See today&apos;s full card →
        </Link>
      </div>
      <p className="text-xs text-muted mt-6 text-center">
        Analysis for entertainment purposes — not financial advice.
      </p>
    </div>
  );
}
