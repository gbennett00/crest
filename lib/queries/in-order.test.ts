import { describe, expect, it } from "vitest";
import { createActionQueue } from "./in-order";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createActionQueue", () => {
  it("starts each action only after the previous one settles", async () => {
    const inOrder = createActionQueue();
    const log: string[] = [];
    let finishFirst!: () => void;
    const first = inOrder(
      () =>
        new Promise<void>((resolve) => {
          log.push("first start");
          finishFirst = () => {
            log.push("first end");
            resolve();
          };
        }),
    );
    const second = inOrder(async () => {
      log.push("second start");
    });

    const done = Promise.all([first(), second()]);
    await tick();
    expect(log).toEqual(["first start"]);
    finishFirst();
    await done;
    expect(log).toEqual(["first start", "first end", "second start"]);
  });

  it("keeps going after a failure and passes results and errors through", async () => {
    const inOrder = createActionQueue();
    const failing = inOrder(async () => {
      throw new Error("boom");
    });
    const next = inOrder(async () => 42);
    await expect(failing()).rejects.toThrow("boom");
    await expect(next()).resolves.toBe(42);
  });
});
