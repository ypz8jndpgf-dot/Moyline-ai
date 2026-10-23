import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * Public landing page for a member-shared pick. A member shares ONE pick
 * from the card; this page renders it as a branded card and funnels to
 * /picks. Deliberately noindex — member word-of-mouth only, no SEO
 * discovery (per the standing no-SEO-until-Stripe call). The pick arrives
 * via query params the member's own share action created; nothing else
 * from the card is exposed here.
 */

type Params = Record<string, string | string[] | undefined>;

function pick(params: Params, key: string, max = 140): string {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] || "" : v || "";
  return s.slice(0, max);
}

function cardImagePath(params: Params): string {
  const qs = new URLSearchParams();
  for (const k of ["g", "p", "pr", "c", "s", "d", "t"]) {
    const v = pick(params, k);
    if (v) qs.set(k, v);
  }
  return `/api/share-card?${qs.toString()}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Params>;
}): Promise<Metadata> {
  const params = await searchParams;
  const game = pick(params, "g") || "MoyLine AI pick";
  const play = pick(params, "p");
  const price = pick(params, "pr", 40);
  const star = pick(params, "s", 1) === "1";
  const title = `${star ? "★ " : ""}${play}${price ? ` ${price}` : ""} — MoyLine AI`;
  const description = `${game} · Every play graded & published at moylineai.com`;
  const image = cardImagePath(params);
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const game = pick(params, "g") || "MoyLine AI";
  const play = pick(params, "p") || "Today's card";
  const price = pick(params, "pr", 40);
  const conf = pick(params, "c", 1);
  const star = pick(params, "s", 1) === "1";
  const dateLabel = pick(params, "d", 40);
  const starts = pick(params, "t", 40);

  return (
    <div className="max-w-xl mx-auto py-10">
      <div className="card card-glow p-6 sm:p-8">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-widest text-gold">
            {star ? "★ Featured play" : "MoyLine AI pick"}
          </span>
          {conf && <span className="text-xs text-muted">Conf {conf}/5</span>}
        </div>
        <h1 className="font-display text-2xl mb-1">{game}</h1>
        {(dateLabel || starts) && (
          <p className="text-xs text-muted mb-2">
            🕐 {[dateLabel, starts].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className="text-2xl font-bold text-goldsoft mb-4">
          {play}{" "}
          {price && <span className="text-base text-muted">{price}</span>}
        </p>
        <p className="text-sm text-muted mb-6">
          Shared by a MoyLine AI member. Our desk grinds every slate —
          spreads, totals, props, injuries, line movement — and every play we
          publish is graded and posted, win or lose.
        </p>
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
