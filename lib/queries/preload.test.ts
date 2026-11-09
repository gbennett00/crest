import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The preloader keeps its queue at module level, so each test loads a fresh copy.
async function loadPreloader() {
  vi.resetModules();
  return (await import("./preload")).preloadWhenIdle;
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("window", { requestIdleCallback: (cb: () => void) => setTimeout(cb, 0) });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("navigator", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("preloadWhenIdle", () => {
  it("runs tasks one at a time, in order", async () => {
    const preloadWhenIdle = await loadPreloader();
    const log: string[] = [];
    const first = deferred();
    preloadWhenIdle(
      async () => {
        log.push("a start");
        await first.promise;
        log.push("a end");
      },
      async () => {
        log.push("b");
      },
    );
    await settle();
    expect(log).toEqual(["a start"]);
    first.resolve();
    await settle();
    expect(log).toEqual(["a start", "a end", "b"]);
  });

  it("keeps going after a task fails, and accepts tasks queued later", async () => {
    const preloadWhenIdle = await loadPreloader();
    const ran: string[] = [];
    preloadWhenIdle(async () => {
      throw new Error("offline");
    });
    preloadWhenIdle(async () => {
      ran.push("after failure");
    });
    await settle();
    preloadWhenIdle(async () => {
      ran.push("queued later");
    });
    await settle();
    expect(ran).toEqual(["after failure", "queued later"]);
  });

  it("does nothing when the device asks to save data", async () => {
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    const preloadWhenIdle = await loadPreloader();
    const task = vi.fn(async () => {});
    preloadWhenIdle(task);
    await settle();
    expect(task).not.toHaveBeenCalled();
  });

  it("waits while the app is in the background", async () => {
    let onVisible: (() => void) | undefined;
    const doc = {
      visibilityState: "hidden",
      addEventListener: (_: string, cb: () => void) => (onVisible = cb),
      removeEventListener: () => {},
    };
    vi.stubGlobal("document", doc);
    const preloadWhenIdle = await loadPreloader();
    const task = vi.fn(async () => {});
    preloadWhenIdle(task);
    await settle();
    expect(task).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    onVisible?.();
    await settle();
    expect(task).toHaveBeenCalledOnce();
  });
});
