import Link from "next/link";
import { auth } from "@/lib/auth";
import { AskClient } from "./AskClient";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const session = await auth();

  if (!session?.user?.email) {
    return (
      <div className="max-w-xl mx-auto text-center py-10">
        <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full border border-gold/40 bg-gold/10 text-gold text-[11px] font-bold uppercase tracking-[0.2em]">
          <span>✨</span> Ask MoyAI
        </div>
        <h1 className="font-display text-4xl mb-4">
          ASK <span className="gold-text">MOYAI</span>
        </h1>
        <p className="text-muted mb-6">
          Sign in to ask about any matchup — lines, leans, and confidence ratings.
        </p>
        <Link href="/signin" className="btn-gold px-8 py-3 inline-block">
          Sign in
        </Link>
      </div>
    );
  }

  return <AskClient />;
}
