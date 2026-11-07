"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Tail the whole card" (optimization #22): one tap tails every
 * upcoming grid pick the member hasn't already tailed, via the
 * add-only bulk form of /api/tails. On success the route refreshes so
 * each pick's own TailButton re-renders in its tailed state.
 */
export default function TailAllButton({
  picks,
  date,
}: {
  picks: { game: string; play: string; price: string }[];
  date?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  if (picks.length === 0) return null;

  async function tailAll() {
    if (busy || done) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/tails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picks, date }),
      });
      if (!res.ok) throw new Error("failed");
      setDone(true);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={tailAll}
      disabled={busy || done}
      className={`px-2.5 py-1 rounded-full border transition-colors disabled:opacity-60 ${
        done
          ? "bg-gold text-black border-gold"
          : "border-gold/60 bg-gold/10 text-gold hover:bg-gold/20"
      }`}
      title="Tail every upcoming pick on today's card at once"
    >
      {done
        ? "✓ Card tailed"
        : busy
          ? "Tailing…"
          : failed
            ? "Retry — tail the whole card"
            : `🎯 Tail the whole card (${picks.length})`}
    </button>
  );
}
