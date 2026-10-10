/* MoyLine AI service worker — KILL SWITCH.
   The old cache-first worker kept serving stale pages on phones. This version
   deletes every cache, unregisters itself, and reloads controlled pages so the
   browser goes back to fetching fresh HTML on every visit. */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => {
        try {
          c.navigate(c.url);
        } catch (_) {}
      });
    })()
  );
});
