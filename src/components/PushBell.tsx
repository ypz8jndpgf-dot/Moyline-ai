"use client";

import { useCallback, useEffect, useState } from "react";

type PushState = "unsupported" | "loading" | "off" | "on" | "denied" | "error";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

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
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const keyRes = await fetch("/api/push/subscribe");
      const keyJson = (await keyRes.json()) as { ok: boolean; publicKey?: string };
      if (!keyJson.ok || !keyJson.publicKey) {
        setState("error");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyJson.publicKey),
      });
      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      setState(saveRes.ok ? "on" : "error");
    } catch {
      setState("error");
    }
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
