"use client";

import { useState } from "react";

/**
 * "Add tonight's games to your calendar" (optimization #77). Builds an
 * .ics of today's card games entirely client-side from the feed data
 * the page already rendered — one event per game, the pick in the
 * description. Start times arrive as ET wall-clock strings ("7:00pm
 * ET") on the feed's ET date; they are converted to real UTC instants
 * via the America/New_York offset for that date (DST-correct). A game
 * whose start time doesn't parse is skipped, never guessed.
 */

export type CalendarGame = {
  game: string;
  play: string;
  price: string;
  starts?: string;
};

/** Parse "7:00pm ET" -> minutes after midnight ET. Null if unparseable
 *  (same convention as StartsIn's parser). */
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

const etFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** America/New_York offset (ET wall − UTC) in minutes at an instant. */
function etOffsetMinutes(instant: Date): number {
  const parts = etFmt.formatToParts(instant);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value || "0", 10);
  let hour = get("hour");
  if (hour === 24) hour = 0; // Intl hour12:false midnight quirk
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return Math.round((wallAsUtc - instant.getTime()) / 60000);
}

/** The UTC instant of an ET wall-clock time on a "YYYY-MM-DD" ET date. */
function etToUtc(dateStr: string, minutesOfDay: number): Date | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const wallAsUtc =
    Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)) +
    minutesOfDay * 60000;
  // Two passes: the offset at the naive guess, then at the refined
  // instant — converges across DST transitions for game-time hours.
  let utc = wallAsUtc - etOffsetMinutes(new Date(wallAsUtc)) * 60000;
  utc = wallAsUtc - etOffsetMinutes(new Date(utc)) * 60000;
  return new Date(utc);
}

function icsStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

const GAME_WINDOW_MS = 3 * 60 * 60 * 1000; // calendar block per game

export default function CalendarButton({
  games,
  date,
}: {
  games: CalendarGame[];
  /** Feed date, "YYYY-MM-DD" (ET) — the anchor for every start time. */
  date?: string;
}) {
  const [note, setNote] = useState<string | null>(null);

  function download() {
    if (!date) {
      setNote("No card date yet");
      return;
    }
    const stamp = icsStamp(new Date());
    const events: string[] = [];
    for (const g of games) {
      const mins = parseStart(g.starts);
      if (mins === null) continue; // unparseable start — skip, never guess
      const start = etToUtc(date, mins);
      if (!start) continue;
      const end = new Date(start.getTime() + GAME_WINDOW_MS);
      const uid =
        `${date}-${g.game}-${g.play}`.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
        "@moylineai.com";
      events.push(
        [
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${icsStamp(start)}`,
          `DTEND:${icsStamp(end)}`,
          `SUMMARY:${icsEscape(g.game)}`,
          `DESCRIPTION:${icsEscape(
            `MoyLine AI pick: ${g.play}${g.price ? ` ${g.price}` : ""} · Full card: moylineai.com/picks`
          )}`,
          "END:VEVENT",
        ].join("\r\n")
      );
    }
    if (events.length === 0) {
      setNote("No start times on the card yet");
      setTimeout(() => setNote(null), 2500);
      return;
    }
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MoyLine AI//Card//EN", ...events, "END:VCALENDAR"].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `moyline-card-${date}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setNote(`✓ ${events.length} game${events.length === 1 ? "" : "s"} saved`);
    setTimeout(() => setNote(null), 2500);
  }

  return (
    <button
      onClick={download}
      className="text-xs font-bold px-3 py-1.5 rounded-full border border-line text-muted hover:border-gold hover:text-gold transition-colors"
      title="Download today's card games as a calendar (.ics) file"
    >
      {note || "📅 Add to calendar"}
    </button>
  );
}
