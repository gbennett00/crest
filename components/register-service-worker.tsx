"use client";

import { useEffect } from "react";

// Registers the minimal service worker at public/sw.js. Silent no-op on
// browsers without support; failures are logged but never surfaced to the
// user since nothing in the app depends on the service worker (yet).
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed", err);
    });
  }, []);

  return null;
}
