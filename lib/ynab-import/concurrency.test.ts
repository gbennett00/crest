import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const delays = [30, 10, 20, 5];
    const results = await mapWithConcurrency(delays, 4, async (delay, i) => {
      await new Promise((r) => setTimeout(r, delay));
      return i;
    });
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it("never runs more than `limit` tasks concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 25 }, (_, i) => i);

    await mapWithConcurrency(items, 5, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return i;
    });

    expect(maxActive).toBeLessThanOrEqual(5);
  });

  it("handles an empty array", async () => {
    const results = await mapWithConcurrency([], 10, async () => 1);
    expect(results).toEqual([]);
  });

  it("handles a limit larger than the item count", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 100, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6]);
  });

  it("propagates a thrown error from any task", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
