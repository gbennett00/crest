// Crest's data is financial and always needs to be fresh, so pages, RSC
// payloads, and API calls are never cached here. Next's build assets under
// /_next/static/ are the exception: each one is content-hashed into its own
// URL, so a given URL's bytes never change — a new deploy ships new hashed
// URLs, it never overwrites an old one. Caching those specifically is what
// makes a cold app-launch fast without ever risking stale data.
const ASSET_CACHE = "crest-assets-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/_next/static/")) return;

  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "Crest", {
      body: data.body,
      icon: "/icon-192.png",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientsList) => {
      // Reuse and navigate any already-open window — there's only ever one
      // in practice — instead of demanding an exact URL match. A warm app
      // switching pages is instant; matching only on exact URL meant a
      // click almost always forced a full cold `openWindow` even when the
      // app was already running in the background.
      for (const client of clientsList) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
