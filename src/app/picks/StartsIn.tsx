"use client";

import { useEffect, useState } from "react";

/**
 * Live "Starts in…" countdown for an upcoming card pick (optimization #48).
 * Computed entirely client-side from the start time already printed on the
 * card ("7:00pm ET") and the card's date — no new data source. Ticks every
 * 30s; at tip it flips to the same ● Live badge the card's StatusBadge
 * renders after a reload, then clears once the live window (3.5h, matching
 * the page's statusFor) has passed. Renders nothing before mount, so the
 * server HTML and first client paint always agree.
 */

/** Parse "7:00pm ET" -> minutes after midnight ET. Null if unparseable.
 *  Local copy of the page's parser — same convention as LiveScore's norm(). */
function parseStart(starts?: string): number | null {
  if (!starts) return null;
  const m = starts.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3].toLowerCase();
  if (ap === "pm" && h !== 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h * 60 + min;
}

/** Whole days since epoch for a "YYYY-MM-DD" date (noon-UTC anchor, the
 *  same trick the trajectory chart uses, so DST never shifts a day). */
function dayIndex(dateStr: string): number | null {
  const t = Date.parse(`${dateStr}T12:00:00Z`);
  return Number.isNaN(t) ? null : Math.floor(t / 86400000);
}

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function nowETMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  return h * 60 + m;
}

const LIVE_WINDOW_MINS = 210; // matches statusFor() on the picks page

export default function StartsIn({
  starts,
  date,
}: {
  starts?: string;
  /** Card date, "YYYY-MM-DD" (the feed's date). */
  date?: string;
}) {
  const [diffMins, setDiffMins] = useState<number | null>(null);

  useEffect(() => {
    const startMins = parseStart(starts);
    const startDay = date ? dayIndex(date) : null;
    if (startMins === null || startDay === null) return;
    const compute = () => {
      const today = dayIndex(todayET());
      if (today === null) return;
      setDiffMins(startDay * 1440 + startMins - (today * 1440 + nowETMinutes()));
    };
    compute();
    const id = setInterval(compute, 30_000);
    return () => clearInterval(id);
  }, [starts, date]);

  if (diffMins === null) return null;
  if (diffMins <= 0) {
    if (diffMins > -LIVE_WINDOW_MINS) {
      return (
        <span className="text-[11px] font-bold uppercase tracking-wider text-down">
          ● Live
        </span>
      );
    }
    return null;
  }
  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  const label =
    h > 0 ? `Starts in ${h}h${m > 0 ? ` ${m}m` : ""}` : `Starts in ${m}m`;
  return <p className="text-xs text-muted mb-1">⏳ {label}</p>;
}
