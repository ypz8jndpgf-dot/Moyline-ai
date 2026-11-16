"use client";

import { useState } from "react";

/**
 * "Tailed it" toggle for members. Posts to /api/tails.
 *
 * Optimization #82: when the card knows the live best price for this
 * pick and it differs from the published price, the tail is recorded
 * at the LIVE price — the number the member can actually get right
 * now — because their My Tails record grades at the stored price.
 * Without a live price the published price is posted, as before.
 */
export default function TailButton({
  game,
  play,
  price,
  livePrice,
  initiallyTailed = false,
}: {
  game: string;
  play: string;
  price: string;
  livePrice?: string | null;
  initiallyTailed?: boolean;
}) {
  const [tailed, setTailed] = useState(initiallyTailed);
  const [busy, setBusy] = useState(false);
  const effectivePrice = livePrice || price;

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
        body: JSON.stringify({ game, play, price: effectivePrice }),
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
      title={
        tailed
          ? "You're tailing this — tap to remove"
          : livePrice
            ? `Tail at the live price ${livePrice} — the number you can actually get now (published ${price})`
            : "Tap to tail this pick"
      }
    >
      {tailed ? "✓ Tailed" : livePrice ? `Tail at ${livePrice} (live)` : "Tail it"}
    </button>
  );
}
