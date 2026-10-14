import Link from "next/link";

export default function UnsubscribeDonePage() {
  return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <h1 className="font-display text-3xl mb-4">
        <span className="gold-text">YOU&apos;RE OUT</span>
      </h1>
      <p className="text-muted text-sm mb-6">
        You&apos;ve been unsubscribed from MoyLine AI daily briefs and morning result
        emails. No more mail from us — the site itself is unaffected.
      </p>
      <p className="text-muted text-sm mb-6">
        Changed your mind? Just sign in again — rejoining as a member re-subscribes you
        automatically.
      </p>
      <Link href="/" className="btn-gold px-8 py-3 inline-block">
        Back to MoyLine AI
      </Link>
    </div>
  );
}
