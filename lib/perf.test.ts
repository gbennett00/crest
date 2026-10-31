import { describe, expect, it } from "vitest";
import { summarizePerf, type PerfEntry } from "./perf";

function entry(flow: string, step: string, ms: number): PerfEntry {
  return { flow, step, ms, at: 0 };
}

describe("summarizePerf", () => {
  it("returns nothing for no entries", () => {
    expect(summarizePerf([])).toEqual([]);
  });

  it("groups by flow and step with median, p90 and max", () => {
    const entries = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((ms) =>
      entry("bulk-approve", "action", ms),
    );
    expect(summarizePerf(entries)).toEqual([
      { flow: "bulk-approve", step: "action", count: 10, medianMs: 50, p90Ms: 90, maxMs: 100 },
    ]);
  });

  it("handles a single sample", () => {
    expect(summarizePerf([entry("first-content", "home", 1200)])).toEqual([
      { flow: "first-content", step: "home", count: 1, medianMs: 1200, p90Ms: 1200, maxMs: 1200 },
    ]);
  });

  it("orders flows by name and steps by median within a flow", () => {
    const rows = summarizePerf([
      entry("txn-save", "refetch", 900),
      entry("bulk-approve", "refetch", 800),
      entry("bulk-approve", "action", 300),
      entry("txn-save", "action", 400),
    ]);
    expect(rows.map((r) => `${r.flow}:${r.step}`)).toEqual([
      "bulk-approve:action",
      "bulk-approve:refetch",
      "txn-save:action",
      "txn-save:refetch",
    ]);
  });
});
