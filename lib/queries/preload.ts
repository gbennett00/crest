"use client";

// Warms data for screens the user hasn't opened yet, so the first tap into
// them renders from cache instead of a skeleton. The intent prefetches on rows
// (hover, focus, pointerdown) give desktop a head start, but on a phone the
// tap navigates ~100 ms after pointerdown, too soon for a fetch to land; only
// preloading ahead of time helps there.
//
// Tasks run one at a time, each when the browser is idle, so they never
// compete with what the user is doing or with each other for the database.
// Nothing runs while the app is in the background or when the device asks to
// save data. Each task is a prefetchQuery call, which skips data that's
// already cached and fresh, so queueing the same screen twice is cheap.

type Task = () => Promise<unknown>;

const queue: Task[] = [];
let running = false;

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
  while (queue.length > 0) {
    await whenVisible();
    await whenIdle();
    const task = queue.shift()!;
    // A failed preload just means that screen loads normally when opened.
    await task().catch(() => {});
  }
  running = false;
}

/** Queues prefetch tasks to run one by one when the browser is idle. */
export function preloadWhenIdle(...tasks: Task[]) {
  if (typeof window === "undefined" || saveDataRequested()) return;
  queue.push(...tasks);
  if (!running) void drain();
}
