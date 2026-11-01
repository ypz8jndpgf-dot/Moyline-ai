"use client";

import { useState } from "react";

/**
 * Copy the whole card as plain text (optimization #33). The server renders
 * the card text (ranked grid, one line per pick: game · play · price) and
 * this button puts it on the clipboard for pasting into a group chat —
 * sharing today is one branded link per pick, so dropping the full card
 * somewhere took five shares.
 */
export default function CopyCardButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable (permissions) — nothing more to do */
    }
  }

  return (
    <button
      onClick={copy}
      className="text-xs font-bold px-3 py-1.5 rounded-full border border-line text-muted hover:border-gold hover:text-gold transition-colors"
      title="Copy the whole card as plain text"
    >
      {copied ? "✓ Card copied" : "📋 Copy card"}
    </button>
  );
}
