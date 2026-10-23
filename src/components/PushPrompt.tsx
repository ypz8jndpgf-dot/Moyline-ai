"use client";

import { useEffect, useState } from "react";
import { subscribeToPush } from "@/lib/push-client";

const SEEN_KEY = "moyline-push-prompt-seen";

/**
 * One-time prompt shown to signed-in members who haven't decided on push
 * notifications yet — the bell toggle in the nav is easy to miss, and push
 * is where the ★ alarm, steam alerts, and target-line alerts actually land.
 * Shows once (localStorage), only when the browser permission is still
 * undecided, and never again after either choice.
 */
export default function PushPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY)) return;
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        return;
      }
      if (Notification.permission !== "default") return;
      setShow(true);
    } catch {
      /* stay hidden */
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode — this session only */
    }
    setShow(false);
  };

  const enable = async () => {
    setBusy(true);
    await subscribeToPush();
    dismiss();
  };

  return (
    <div className="card p-4 sm:p-5 mb-6 border-gold/50 bg-gold/5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="text-3xl" aria-hidden>
          🔔
        </div>
        <div className="flex-1 min-w-[220px]">
          <p className="font-display text-lg leading-tight">
            Never miss a <span className="gold-text">★ play</span>
          </p>
          <p className="text-sm text-muted mt-1">
            Turn on push alerts for 5-star plays, steam on your card, and your
            target lines. No spam — only the moments that matter.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={enable}
            disabled={busy}
            className="btn-gold px-5 py-2.5 disabled:opacity-50"
          >
            {busy ? "Turning on…" : "Turn on alerts"}
          </button>
          <button onClick={dismiss} className="btn-ghost px-4 py-2.5">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
