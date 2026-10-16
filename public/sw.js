/* MoyLine AI service worker — push notifications, no caching.
   This worker NEVER caches pages (the old cache-first worker served stale
   layouts, so caching is deliberately absent). Fetches pass straight through
   to the network. The worker exists to receive Web Push notifications. */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Belt-and-braces: delete any caches left by older workers.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (_) {}
      await self.clients.claim();
    })()
  );
});

// No fetch handler: every request goes to the network (no stale pages).

self.addEventListener("push", (event) => {
  let data = { title: "MoyLine AI", body: "", url: "/picks" };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (_) {}
  const title = data.title || "MoyLine AI";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon",
      badge: "/icon",
      data: { url: data.url || "/picks" },
      tag: "moyline-" + Date.now(),
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/picks";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        try {
          if ("focus" in c) {
            await c.focus();
            if ("navigate" in c) await c.navigate(url);
            return;
          }
        } catch (_) {}
      }
      await self.clients.openWindow(url);
    })()
  );
});
