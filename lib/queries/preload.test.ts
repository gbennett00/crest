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

type Doc = {
  visibilityState: string;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: () => void;
};

let doc: Doc;
let onVisible: (() => void) | undefined;

beforeEach(() => {
  onVisible = undefined;
  doc = {
    visibilityState: "visible",
    addEventListener: (_type, cb) => (onVisible = cb),
    removeEventListener: () => {},
  };
  vi.stubGlobal("window", { requestIdleCallback: (cb: () => void) => setTimeout(cb, 0) });
  vi.stubGlobal("document", doc);
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
    preloadWhenIdle([
      async () => {
        log.push("a start");
        await first.promise;
        log.push("a end");
      },
      () => log.push("b"),
    ]);
    await settle();
    expect(log).toEqual(["a start"]);
    first.resolve();
    await settle();
    expect(log).toEqual(["a start", "a end", "b"]);
  });

  it("keeps going after a task rejects or throws, and accepts tasks queued later", async () => {
    const preloadWhenIdle = await loadPreloader();
    const ran: string[] = [];
    preloadWhenIdle([
      async () => {
        throw new Error("offline");
      },
      () => {
        throw new Error("thrown before returning a promise");
      },
      () => ran.push("after failures"),
    ]);
    await settle();
    preloadWhenIdle([() => ran.push("queued later")]);
    await settle();
    expect(ran).toEqual(["after failures", "queued later"]);
  });

  it("drops a group's tasks that haven't run when the group is queued again", async () => {
    const preloadWhenIdle = await loadPreloader();
    const ran: string[] = [];
    const blocker = deferred();
    preloadWhenIdle([() => blocker.promise]);
    preloadWhenIdle([() => ran.push("old 1"), () => ran.push("old 2")], { group: "rows" });
    preloadWhenIdle([() => ran.push("other")]);
    preloadWhenIdle([() => ran.push("new")], { group: "rows" });
    await settle();
    blocker.resolve();
    await settle();
    expect(ran).toEqual(["other", "new"]);
  });

  it("runs `first` tasks ahead of what's already queued", async () => {
    const preloadWhenIdle = await loadPreloader();
    const ran: string[] = [];
    const blocker = deferred();
    preloadWhenIdle([() => blocker.promise, () => ran.push("startup")]);
    await settle();
    preloadWhenIdle([() => ran.push("on screen")], { first: true });
    blocker.resolve();
    await settle();
    expect(ran).toEqual(["on screen", "startup"]);
  });

  it("does nothing when the device asks to save data", async () => {
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    const preloadWhenIdle = await loadPreloader();
    const task = vi.fn();
    preloadWhenIdle([task]);
    await settle();
    expect(task).not.toHaveBeenCalled();
  });

  it("checks visibility after the idle wait, so nothing starts in the background", async () => {
    // Hidden by the time the idle callback fires.
    vi.stubGlobal("window", {
      requestIdleCallback: (cb: () => void) =>
        setTimeout(() => {
          doc.visibilityState = "hidden";
          cb();
        }, 0),
    });
    const preloadWhenIdle = await loadPreloader();
    const task = vi.fn();
    preloadWhenIdle([task]);
    await settle();
    expect(task).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    onVisible?.();
    await settle();
    expect(task).toHaveBeenCalledOnce();
  });
});
