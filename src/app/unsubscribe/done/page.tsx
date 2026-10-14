import Link from "next/link";

export default function UnsubscribeDonePage() {
  return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <h1 className="font-display text-3xl mb-4">
        <span className="gold-text">No hard feelings 🤝</span>
      </h1>
      <p className="text-paper/90 mb-4">
        You&apos;re off the list — no more daily briefs or morning result emails
        headed your way.
      </p>
      <p className="text-muted text-sm mb-6">
        The site itself is untouched, so your picks, tails, and account are right
        where you left them whenever you want to check in.
      </p>
      <p className="text-muted text-sm mb-8">
        Miss us? Just sign back in — rejoining as a member puts you back on the
        list automatically. We&apos;ll be here.
      </p>
      <Link href="/" className="btn-gold px-8 py-3 inline-block">
        Back to MoyLine AI
      </Link>
    </div>
  );
}
