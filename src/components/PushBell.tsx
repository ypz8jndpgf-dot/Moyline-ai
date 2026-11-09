"use client";

import { useCallback, useEffect, useState } from "react";
import { subscribeToPush } from "@/lib/push-client";

type PushState = "unsupported" | "loading" | "off" | "on" | "denied" | "error";
type TestStatus = "idle" | "sending" | "sent" | "failed";

/**
 * Bell toggle for Web Push notifications (new ★ plays, steam alerts).
 * Render only for signed-in members.
 *
 * When alerts are on, a "Test" button beside the bell opens a small
 * panel with "Send me a test push" (Optimization #63): it calls
 * /api/push/test, which delivers one test notification to the member's
 * own stored subscription through the same path as real alerts, and
 * reports the outcome inline — success only if the push service
 * accepted it.
 */
export default function PushBell() {
  const [state, setState] = useState<PushState>("loading");
  const [testOpen, setTestOpen] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMsg, setTestMsg] = useState("");

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enable = async () => {
    setState("loading");
    setState(await subscribeToPush());
  };

  const disable = async () => {
    setState("loading");
    setTestOpen(false);
    setTestStatus("idle");
    setTestMsg("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await fetch("/api/push/unsubscribe", { method: "POST" });
    } catch {
      /* best effort */
    }
    refresh();
  };

  const sendTest = async () => {
    setTestStatus("sending");
    setTestMsg("");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = (await res.json()) as {
        ok: boolean;
        reason?: string;
        error?: string;
      };
      if (data.ok) {
        setTestStatus("sent");
        setTestMsg("Test sent — check your notifications.");
        setTimeout(() => {
          setTestOpen(false);
          setTestStatus("idle");
          setTestMsg("");
        }, 3000);
      } else {
        setTestStatus("failed");
        setTestMsg(data.error || "Test push failed — try again.");
        // The server pruned a dead subscription (or never had one):
        // resync the bell with this device's actual state.
        if (data.reason === "expired" || data.reason === "no-subscription") {
          refresh();
        }
      }
    } catch {
      setTestStatus("failed");
      setTestMsg("Network error — test push not sent.");
    }
  };

  if (state === "unsupported" || state === "loading") return null;

  if (state === "denied") {
    return (
      <span
        className="px-2 py-1.5 text-muted cursor-help"
        title="Notifications are blocked — enable them in your browser's site settings to get ★ play and steam alerts."
      >
        🔕
      </span>
    );
  }

  const on = state === "on";
  const bell = (
    <button
      onClick={on ? disable : enable}
      className={`px-2 py-1.5 rounded shrink-0 ${
        on ? "text-gold" : "text-muted hover:text-gold"
      }`}
      title={
        on
          ? "Push alerts on — tap to turn off (★ plays, steam alerts)"
          : state === "error"
            ? "Couldn't set up alerts — tap to retry"
            : "Tap for push alerts: new ★ plays and steam on your card"
      }
      aria-label={on ? "Turn off push notifications" : "Turn on push notifications"}
    >
      {on ? "🔔" : "🔕"}
    </button>
  );

  if (!on) return bell;

  return (
    <span className="relative inline-flex items-center shrink-0">
      {bell}
      <button
        onClick={() => setTestOpen(!testOpen)}
        className="text-[11px] font-bold text-muted hover:text-gold transition-colors pr-1"
        title="Send a test push to confirm alerts work"
      >
        Test
      </button>
      {testOpen && (
        <div className="absolute z-20 top-full mt-2 right-0 w-64 card p-4 shadow-xl border-gold/30 text-left">
          <p className="text-xs font-bold mb-1">Test push alerts</p>
          <p className="text-[11px] text-muted mb-3">
            Sends one test notification to your account&apos;s saved push
            subscription — the same delivery path as ★ play and steam
            alerts.
          </p>
          <button
            onClick={sendTest}
            disabled={testStatus === "sending"}
            className="btn-gold px-4 py-2 text-sm font-bold rounded disabled:opacity-50 w-full"
          >
            {testStatus === "sending" ? "Sending…" : "Send me a test push"}
          </button>
          {testStatus === "sent" && (
            <p className="text-emerald-400 text-xs mt-2">✓ {testMsg}</p>
          )}
          {testStatus === "failed" && (
            <p className="text-red-400 text-xs mt-2">{testMsg}</p>
          )}
          <button
            onClick={() => setTestOpen(false)}
            className="absolute top-2 right-2 text-muted hover:text-white text-xs"
            aria-label="Close test push panel"
          >
            ✕
          </button>
        </div>
      )}
    </span>
  );
}
