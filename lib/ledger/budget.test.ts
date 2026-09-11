import { describe, expect, it } from "vitest";

import { LedgerError } from "./errors";
import {
  assertBudgetMonth,
  computeAvailable,
  computeAvailableThrough,
  computeAvailableWithOverspend,
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

describe("computeAvailableWithOverspend", () => {
  it("matches computeAvailableThrough when nothing goes negative", () => {
    // Jan +500, Feb -200 → 300, Mar +100 -50 → 350; never crosses zero.
    const activity = { "2026-02-01": -20000, "2026-03-01": -5000 };
    const assigned = { "2026-01-01": 50000, "2026-03-01": 10000 };
    const res = computeAvailableWithOverspend("2026-03-01", activity, assigned);
    expect(res.availableCents).toBe(35000);
    expect(res.cashOverspentBeforeCents).toBe(0);
  });

  it("shows a cash overspend in its own month but does not carry it forward", () => {
    // Feb: spend $134.37 with no assignment → -134.37 in February…
    const activity = { "2026-02-01": -13437 };
    const feb = computeAvailableWithOverspend("2026-02-01", activity, {});
    expect(feb.availableCents).toBe(-13437);
    expect(feb.cashOverspentBeforeCents).toBe(0); // charged next month, not this one

    // …but March resets to $0 (the overspend was charged to March's RTA).
    const mar = computeAvailableWithOverspend("2026-03-01", activity, {});
    expect(mar.availableCents).toBe(0);
    expect(mar.cashOverspentBeforeCents).toBe(13437);
  });

  it("keeps charging cumulative cash overspend in every later month", () => {
    const activity = { "2026-02-01": -13437 };
    const sep = computeAvailableWithOverspend("2026-09-01", activity, {});
    expect(sep.availableCents).toBe(0);
    expect(sep.cashOverspentBeforeCents).toBe(13437);
  });

  it("lets a later inflow to a reset category sit as positive available", () => {
    // Feb overspend resets; Sep reimbursement (+134.37) lands as available.
    const activity = { "2026-02-01": -13437, "2026-09-01": 13437 };
    const sep = computeAvailableWithOverspend("2026-09-01", activity, {});
    expect(sep.availableCents).toBe(13437);
    // The Feb cash overspend still hit an earlier month's RTA and stays charged.
    expect(sep.cashOverspentBeforeCents).toBe(13437);
  });

  it("carries uncovered credit overspending forward instead of resetting it", () => {
    // Assigned $50, a $70 credit-card purchase (all of it in creditOutflow).
    // Funded $50; the $20 uncovered is credit debt that must keep rolling.
    const activity = { "2026-02-01": -7000 };
    const assigned = { "2026-02-01": 5000 };
    const outflow = { "2026-02-01": 7000 };
    const feb = computeAvailableWithOverspend("2026-02-01", activity, assigned, outflow);
    expect(feb.availableCents).toBe(-2000);

    const mar = computeAvailableWithOverspend("2026-03-01", activity, assigned, outflow);
    expect(mar.availableCents).toBe(-2000); // still -20, not reset
    expect(mar.cashOverspentBeforeCents).toBe(0); // credit debt never hits RTA
  });

  it("splits a mixed cash+credit overspend: cash resets, credit carries", () => {
    // Assigned $50; $60 cash spend + $30 credit purchase in Feb.
    // Cash overspends by $10; the whole $30 credit is uncovered.
    const activity = { "2026-02-01": -9000 }; // -60 cash + -30 credit
    const assigned = { "2026-02-01": 5000 };
    const outflow = { "2026-02-01": 3000 };
    const feb = computeAvailableWithOverspend("2026-02-01", activity, assigned, outflow);
    expect(feb.availableCents).toBe(-4000); // -40 shown in February

    const mar = computeAvailableWithOverspend("2026-03-01", activity, assigned, outflow);
    expect(mar.availableCents).toBe(-3000); // only the $30 credit debt carries
    expect(mar.cashOverspentBeforeCents).toBe(1000); // the $10 cash hit RTA
  });
});
