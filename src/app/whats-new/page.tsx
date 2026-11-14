import { WHATS_NEW } from "@/lib/whats-new";

export const metadata = { title: "What's New | MoyLine AI" };

/** "Nov 14, 2026" from a "YYYY-MM-DD" build date (noon-UTC anchor, so
 *  the printed day never shifts with the reader's timezone). */
function fmtDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "What's new" (optimization #78): the shipped-feature feed. Features
 * used to land silently — members found them by stumbling onto them.
 * The list lives in src/lib/whats-new.ts; every build appends a line.
 */
export default function WhatsNewPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-display text-4xl mb-1">
        WHAT&apos;S <span className="gold-text">NEW</span>
      </h1>
      <p className="text-muted text-sm mb-6">
        Every feature the desk ships gets one line here, the day it lands —
        newest first.
      </p>
      <div className="space-y-3">
        {WHATS_NEW.map((e) => (
          <div key={`${e.date}-${e.title}`} className="card p-4">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <h2 className="font-bold text-paper">{e.title}</h2>
              <span className="text-xs text-muted shrink-0">{fmtDate(e.date)}</span>
            </div>
            <p className="text-sm text-muted">{e.blurb}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
