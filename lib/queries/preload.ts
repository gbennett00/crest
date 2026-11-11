"use client";

// Warms data for screens the user hasn't opened yet, so the first tap into
// them renders from cache instead of a skeleton. The intent prefetches on rows
// (hover, focus, pointerdown) give desktop a head start, but on a phone the
// tap navigates ~100 ms after pointerdown, too soon for a fetch to land; only
// preloading ahead of time helps there.
//
// Tasks run one at a time, each once the browser is idle and no other data
// request is in flight, so they never compete with what the user is doing (a
// screen's own load included) or with each other for the database. Nothing
// runs while the app is in the background or when the device asks to save
// data. Each task is usually a prefetchQuery call, which skips data that's
// already cached and fresh.

import type { QueryClient } from "@tanstack/react-query";

type Task = () => unknown;

type Options = {
  /**
   * Queuing a group again drops its tasks that haven't run yet, so work for
   * a screen that has since changed (a new search, another month, a second
   * mount of the same component) doesn't pile up.
   */
  group?: string;
  /**
   * Run ahead of what's already queued: for what's on screen now, which is
   * more likely to be tapped next than anything queued at startup.
   */
  first?: boolean;
};

type Entry = { task: Task; group?: string };

const queue: Entry[] = [];
let running = false;
let client: QueryClient | null = null;

// The longest a task waits for other requests to finish, so a stuck request
// or a steady stream of refetches can't hold the queue up forever.
const QUIET_TIMEOUT_MS = 10_000;

/**
 * Lets the preloader see the app's requests, to wait for them (see
 * QueryProvider). Returns the disconnect.
 */
export function connectPreloader(queryClient: QueryClient) {
  client = queryClient;
  return () => {
    if (client === queryClient) client = null;
  };
}

function saveDataRequested(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 2000 });
    } else {
      setTimeout(resolve, 200);
    }
  });
}

/** Resolves once no query is fetching (or after QUIET_TIMEOUT_MS). */
function whenQuiet(): Promise<void> {
  const qc = client;
  if (!qc || qc.isFetching() === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      unsubscribe();
      clearTimeout(timer);
      resolve();
    };
    const unsubscribe = qc.getQueryCache().subscribe(() => {
      if (qc.isFetching() === 0) done();
    });
    const timer = setTimeout(done, QUIET_TIMEOUT_MS);
  });
}

function whenVisible(): Promise<void> {
  if (document.visibilityState === "visible") return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onChange);
      resolve();
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

async function drain() {
  running = true;
  try {
    while (queue.length > 0) {
      await whenIdle();
      await whenQuiet();
      // Last, right before running: the idle wait's timeout can fire in a
      // hidden tab.
      await whenVisible();
      const entry = queue.shift();
      if (!entry) continue;
      try {
        // A failed preload just means that screen loads normally when opened.
        await entry.task();
      } catch {
        // Ignored, as above, whether it threw or rejected.
      }
    }
  } finally {
    running = false;
  }
}

/** Queues prefetch tasks to run one by one when the browser is idle. */
export function preloadWhenIdle(tasks: Task[], { group, first = false }: Options = {}) {
  if (typeof window === "undefined" || saveDataRequested()) return;
  if (group) {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].group === group) queue.splice(i, 1);
    }
  }
  const entries = tasks.map((task) => ({ task, group }));
  if (first) queue.unshift(...entries);
  else queue.push(...entries);
  if (!running) void drain();
}
