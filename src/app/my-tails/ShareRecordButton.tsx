"use client";

import { useState } from "react";

/**
 * Share your tail record as a branded card (optimization #75). The
 * server page computes the member's real graded stats from their
 * stored tails and hands this button an already-signed /share-record
 * path (lib/record-share.ts) — the card can only ever show the numbers
 * the server issued. Native share sheet when available, clipboard
 * fallback, mirroring the single-pick ShareButton.
 */
export default function ShareRecordButton({
  path,
  recordText,
}: {
  /** Signed /share-record path (+ query) built server-side. */
  path: string;
  /** "My tails: 14-9 · +3.2u" — the share sheet's text. */
  recordText: string;
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}${path}`;
    const text = `${recordText} — MoyLine AI`;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "My MoyLine AI tail record", text, url });
        return;
      } catch (e) {
        // Member closed the share sheet — not an error, don't fall through.
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable (permissions) — nothing more to do */
    }
  }

  return (
    <button
      onClick={share}
      className="text-xs font-bold px-3 py-1.5 rounded-full border border-line text-muted hover:border-gold hover:text-gold transition-colors"
      title="Share your tail record as a branded card"
    >
      {copied ? "✓ Link copied" : "Share record ↗"}
    </button>
  );
}
