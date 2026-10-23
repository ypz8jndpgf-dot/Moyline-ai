"use client";

import { useCallback, useEffect, useState } from "react";
import { subscribeToPush } from "@/lib/push-client";

type PushState = "unsupported" | "loading" | "off" | "on" | "denied" | "error";

/**
 * Bell toggle for Web Push notifications (new ★ plays, steam alerts).
 * Render only for signed-in members.
 */
export default function PushBell() {
  const [state, setState] = useState<PushState>("loading");

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
  return (
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
}
