// Minimal service worker. It intentionally caches nothing — Crest's data is
// financial and always needs to be fresh — but a registered, active service
// worker is required for the app to count as an installed PWA (and is a
// prerequisite for Web Push on iOS). Add caching or a `push` handler here
// when those land; for now this just needs to exist and activate.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
