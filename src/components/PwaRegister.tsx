"use client";

import { useEffect } from "react";

/**
 * Registers the MoyLine AI service worker (/sw.js).
 *
 * The worker NEVER caches pages — every fetch goes to the network, so the
 * odds board can never show stale layouts (the reason the old cache-first
 * worker was killed). The worker exists to receive Web Push notifications
 * (new ★ plays, steam alerts); see the PushBell component for opt-in.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Clear any caches left behind by the retired cache-first worker,
    // then register the push-only worker.
    if ("caches" in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {});
    }
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => {
        /* push unavailable — the site works fine without it */
      });
  }, []);
  return null;
}
