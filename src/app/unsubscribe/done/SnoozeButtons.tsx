"use client";

import { useState } from "react";

/**
 * Snooze-instead-of-unsubscribe controls on the unsubscribe confirmation
 * page (optimization #17). Rendered only when the page carries the
 * email+token from the one-click redirect. Picking a pause calls
 * /api/unsubscribe with snoozeDays, which stores the pause and clears
 * the permanent unsubscribe the one-click just recorded.
 */
export default function SnoozeButtons({
  email,
  token,
}: {
  email: string;
  token: string;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "done"; until: string }
    | { kind: "error" }
  >({ kind: "idle" });

  async function snooze(days: 7 | 30) {
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token, snoozeDays: days }),
      });
      const data = (await res.json()) as { ok?: boolean; snoozedUntil?: string };
      if (data.ok && data.snoozedUntil) {
        setState({ kind: "done", until: data.snoozedUntil });
      } else {
        setState({ kind: "error" });
      }
    } catch {
      setState({ kind: "error" });
    }
  }

  if (state.kind === "done") {
    const date = new Date(state.until).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    return (
      <div className="card p-5 mb-8">
        <p className="text-paper/90 font-semibold mb-1">Paused instead 😴</p>
        <p className="text-muted text-sm">
          Briefs are paused — they&apos;ll resume automatically on {date}. No
          need to sign up again.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-5 mb-8">
      <p className="text-paper/90 font-semibold mb-1">Just need a break?</p>
      <p className="text-muted text-sm mb-4">
        Pause the briefs instead of leaving for good — they resume on their
        own, and your account stays exactly as it is.
      </p>
      <div className="flex flex-wrap gap-3 justify-center">
        <button
          type="button"
          disabled={state.kind === "busy"}
          onClick={() => snooze(7)}
          className="btn-gold px-6 py-2.5 disabled:opacity-50"
        >
          Pause 1 week
        </button>
        <button
          type="button"
          disabled={state.kind === "busy"}
          onClick={() => snooze(30)}
          className="btn-gold px-6 py-2.5 disabled:opacity-50"
        >
          Pause 1 month
        </button>
      </div>
      {state.kind === "error" && (
        <p className="text-red-300/80 text-xs mt-3">
          That didn&apos;t go through — you&apos;re still unsubscribed, and
          signing back in rejoins the list anytime.
        </p>
      )}
    </div>
  );
}
