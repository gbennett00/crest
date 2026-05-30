import { describe, expect, it } from "vitest";

import { LedgerError } from "./errors";
import {
  assertBudgetMonth,
  computeAvailable,
  computeAvailableThrough,
  nextBudgetMonth,
  previousBudgetMonth,
} from "./budget";

describe("assertBudgetMonth", () => {
  it("accepts first-of-month dates", () => {
    expect(() => assertBudgetMonth("2026-01-01")).not.toThrow();
    expect(() => assertBudgetMonth("2026-05-01")).not.toThrow();
    expect(() => assertBudgetMonth("2026-12-01")).not.toThrow();
  });

  it("rejects mid-month dates", () => {
    expect(() => assertBudgetMonth("2026-05-15")).toThrow(LedgerError);
    expect(() => assertBudgetMonth("2026-05-02")).toThrow(LedgerError);
    expect(() => assertBudgetMonth("2026-05-31")).toThrow(LedgerError);
  });

  it("rejects malformed strings", () => {
    expect(() => assertBudgetMonth("2026-5-01")).toThrow(LedgerError);
    expect(() => assertBudgetMonth("2026/05/01")).toThrow(LedgerError);
    expect(() => assertBudgetMonth("2026-05")).toThrow(LedgerError);
    expect(() => assertBudgetMonth("")).toThrow(LedgerError);
  });
});

describe("nextBudgetMonth", () => {
  it("advances within a year", () => {
    expect(nextBudgetMonth("2026-05-01")).toBe("2026-06-01");
    expect(nextBudgetMonth("2026-01-01")).toBe("2026-02-01");
  });

  it("wraps December to January of the next year", () => {
    expect(nextBudgetMonth("2026-12-01")).toBe("2027-01-01");
  });
});

describe("previousBudgetMonth", () => {
  it("goes back within a year", () => {
    expect(previousBudgetMonth("2026-05-01")).toBe("2026-04-01");
    expect(previousBudgetMonth("2026-12-01")).toBe("2026-11-01");
  });

  it("wraps January to December of the previous year", () => {
    expect(previousBudgetMonth("2026-01-01")).toBe("2025-12-01");
  });
});

describe("computeAvailable", () => {
  it("sums last-month available, assigned, and activity", () => {
    // Starting from 0, assign $300, spend $50 → $250 remaining
    expect(computeAvailable(0, 30000, -5000)).toBe(25000);
  });

  it("carries previous balance forward when assigned and activity are zero", () => {
    expect(computeAvailable(10000, 0, 0)).toBe(10000);
  });

  it("produces negative available when overspent", () => {
    expect(computeAvailable(0, 5000, -8000)).toBe(-3000);
  });

  it("handles inflows (positive activity)", () => {
    // Income deposited to Ready to Assign
    expect(computeAvailable(0, 0, 200000)).toBe(200000);
  });
});

describe("computeAvailableThrough", () => {
  it("returns 0 when no data exists", () => {
    expect(computeAvailableThrough("2026-05-01", {}, {})).toBe(0);
  });

  it("returns 0 when all data is after the target month", () => {
    expect(
      computeAvailableThrough("2026-04-01", { "2026-05-01": -5000 }, {}),
    ).toBe(0);
  });

  it("computes a single month correctly", () => {
    expect(
      computeAvailableThrough(
        "2026-05-01",
        { "2026-05-01": -5000 },
        { "2026-05-01": 30000 },
      ),
    ).toBe(25000);
  });

  it("accumulates available across multiple months with rollover", () => {
    // Jan: assigned $500 → available $500
    // Feb: activity -$200 → available $300
    // Mar: assigned $100, activity -$50 → available $350
    expect(
      computeAvailableThrough(
        "2026-03-01",
        { "2026-02-01": -20000, "2026-03-01": -5000 },
        { "2026-01-01": 50000, "2026-03-01": 10000 },
      ),
    ).toBe(35000);
  });

  it("carries balance through gap months with no data", () => {
    // Apr: assigned $100 → available $100
    // May: (no data) → available $100 unchanged
    // Jun: activity -$30 → available $70
    expect(
      computeAvailableThrough(
        "2026-06-01",
        { "2026-06-01": -3000 },
        { "2026-04-01": 10000 },
      ),
    ).toBe(7000);
  });

  it("ignores future data beyond throughMonth", () => {
    // Jan: assigned $500 → $500
    // ask for Jan only — Jun data must not leak in
    expect(
      computeAvailableThrough(
        "2026-01-01",
        { "2026-06-01": -99999 },
        { "2026-01-01": 50000 },
      ),
    ).toBe(50000);
  });
});
