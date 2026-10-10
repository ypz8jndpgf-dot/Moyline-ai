"use client";

import { useState } from "react";

/** "Tailed it" toggle for members. Posts to /api/tails. */
export default function TailButton({
  game,
  play,
  price,
  initiallyTailed = false,
}: {
  game: string;
  play: string;
  price: string;
  initiallyTailed?: boolean;
}) {
  const [tailed, setTailed] = useState(initiallyTailed);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    // Optimistic update
    const next = !tailed;
    setTailed(next);
    try {
      const res = await fetch("/api/tails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game, play, price }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setTailed(!!data.tailed);
    } catch {
      setTailed(!next); // revert
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`text-xs font-bold px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
        tailed
          ? "bg-gold text-black border-gold"
          : "border-line text-muted hover:border-gold hover:text-gold"
      }`}
      title={tailed ? "You're tailing this — tap to remove" : "Tap to tail this pick"}
    >
      {tailed ? "✓ Tailed" : "Tail it"}
    </button>
  );
}
