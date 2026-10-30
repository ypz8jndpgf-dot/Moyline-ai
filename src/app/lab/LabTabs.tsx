"use client";

import { useState, type ReactNode } from "react";

/** Parlay Lab modes: the classic ticket builder, or the guided Cheatsheet. */
export default function LabTabs({ lab, sheet }: { lab: ReactNode; sheet: ReactNode }) {
  const [mode, setMode] = useState<"lab" | "sheet">("lab");
  const pill = (active: boolean) =>
    `px-5 py-2.5 rounded-full text-sm font-bold border transition min-h-[44px] inline-flex items-center justify-center ${
      active
        ? "bg-gold text-ink border-gold"
        : "border-line text-muted hover:text-paper hover:border-gold/50"
    }`;
  return (
    <div>
      <div className="flex gap-2 mb-6">
        <button className={pill(mode === "lab")} onClick={() => setMode("lab")}>
          🎟️ Ticket Lab
        </button>
        <button className={pill(mode === "sheet")} onClick={() => setMode("sheet")}>
          📋 Cheatsheet
        </button>
      </div>
      {mode === "lab" ? lab : sheet}
    </div>
  );
}
