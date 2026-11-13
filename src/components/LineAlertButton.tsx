"use client";

import { useState } from "react";

type Props = {
  game: string; // normalized game key for matching
  gameLabel: string; // display label
  market: "spread" | "total" | "moneyline" | "prop";
  side: string; // e.g. "Chiefs" or "Over"
  currentLine: number | null;
  // Prop alerts only (optimization #73): the player + parsed market the
  // target line applies to, from the Cheatsheet leg being rendered.
  player?: string;
  propMarket?: string;
  propLabel?: string;
};

function fmtTarget(market: Props["market"], v: number): string {
  if (market === "moneyline") return v > 0 ? `+${v}` : `${v}`;
  return `${v}`;
}

/**
 * "Set line alert" button for odds board game cards.
 * Opens a small popover to pick a target line; POSTs to /api/alerts.
 */
export default function LineAlertButton({ game, gameLabel, market, side, currentLine, player, propMarket, propLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const isMoneyline = market === "moneyline";
  const isProp = market === "prop";

  const submit = async () => {
    const t = isMoneyline ? parseInt(target, 10) : parseFloat(target);
    if (isNaN(t) || (isMoneyline && (t === 0 || Math.abs(t) < 100))) {
      setError(
        isMoneyline
          ? "Enter an American price (e.g. -120 or +130)"
          : "Enter a valid number"
      );
      return;
    }
    setStatus("saving");
    setError("");
    try {
      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          game,
          gameLabel,
          market,
          side,
          target: t,
          ...(isProp ? { player, propMarket, propLabel } : {}),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("done");
        setTimeout(() => {
          setOpen(false);
          setStatus("idle");
          setTarget("");
        }, 1500);
      } else {
        setError(data.error || "Failed to set alert");
        setStatus("error");
      }
    } catch {
      setError("Network error");
      setStatus("error");
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] font-bold text-gold hover:text-goldsoft transition-colors"
        title="Get notified when this line hits your target"
      >
        🔔 Alert
      </button>
      {open && (
        <div className="absolute z-20 bottom-full mb-2 left-0 w-64 card p-4 shadow-xl border-gold/30">
          <p className="text-xs font-bold mb-1">Line alert</p>
          <p className="text-[11px] text-muted mb-3">
            {isProp ? (
              <>
                {player} · {side} {propLabel}
                <span className="block mt-1">{gameLabel}</span>
              </>
            ) : (
              <>{gameLabel} · {side} {market}</>
            )}
            {currentLine !== null && (
              <span className="block mt-1">
                Current: {fmtTarget(market, currentLine)}
              </span>
            )}
            {isMoneyline && (
              <span className="block mt-1">
                Fires when the best price reaches your target or better.
              </span>
            )}
            {isProp && (
              <span className="block mt-1">
                Fires when the best line for this side reaches your target or
                better — Over: at or below your number · Under: at or above it.
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              step={isMoneyline ? "1" : "0.5"}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={
                isMoneyline
                  ? "e.g. +130"
                  : isProp
                    ? "e.g. 24.5"
                    : market === "spread"
                      ? "e.g. -3"
                      : "e.g. 47.5"
              }
              className="flex-1 bg-white/5 border border-line rounded px-3 py-2 text-sm focus:border-gold focus:outline-none"
            />
            <button
              onClick={submit}
              disabled={status === "saving"}
              className="btn-gold px-4 py-2 text-sm font-bold rounded disabled:opacity-50"
            >
              {status === "saving" ? "..." : "Set"}
            </button>
          </div>
          {status === "done" && (
            <p className="text-emerald-400 text-xs mt-2">✓ Alert set! We'll notify you.</p>
          )}
          {status === "error" && (
            <p className="text-red-400 text-xs mt-2">{error}</p>
          )}
          <button
            onClick={() => setOpen(false)}
            className="absolute top-2 right-2 text-muted hover:text-white text-xs"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
