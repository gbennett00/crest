import { describe, expect, it } from "vitest";
import { createServerTimer, formatServerTiming } from "./server-timing";

describe("formatServerTiming", () => {
  it("formats spans as Server-Timing metrics", () => {
    expect(
      formatServerTiming([
        { name: "budget", ms: 12.345 },
        { name: "total", ms: 40 },
      ]),
    ).toBe("budget;dur=12.3, total;dur=40.0");
  });

  it("replaces characters that aren't valid in a metric name", () => {
    expect(formatServerTiming([{ name: "budget view:2026", ms: 1 }])).toBe(
      "budget_view_2026;dur=1.0",
    );
  });
});

describe("createServerTimer", () => {
  it("records a span for each timed call, plus total", async () => {
    const timer = createServerTimer("test");
    await timer.time("a", async () => 1);
    await timer.time("b", async () => 2);
    expect(timer.header()).toMatch(/^a;dur=[\d.]+, b;dur=[\d.]+, total;dur=[\d.]+$/);
  });

  it("returns the timed function's value", async () => {
    const timer = createServerTimer("test");
    expect(await timer.time("a", async () => "value")).toBe("value");
  });

  it("still records the span when the timed function throws", async () => {
    const timer = createServerTimer("test");
    await expect(
      timer.time("boom", async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(timer.header()).toMatch(/^boom;dur=/);
  });
});
