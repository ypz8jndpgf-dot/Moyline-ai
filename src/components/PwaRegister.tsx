"use client";

import { useEffect } from "react";

/**
 * The service worker kept serving stale cached pages on phones (users saw
 * layouts from several deploys ago). A live odds board must never show old
 * data, so we unregister any service worker and clear its caches, then stay
 * unregistered. Fresh HTML comes from the network on every visit.
 */
export default function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
    }
    if ("caches" in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {});
    }
  }, []);
  return null;
}
