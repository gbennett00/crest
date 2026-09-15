import { describe, expect, it } from "vitest";
import { getPeriodRange, yearFromPeriodKey, yearPeriodKey } from "./period";

describe("getPeriodRange", () => {
  it("this month", () => {
    expect(getPeriodRange("month", "2026-09-01")).toEqual({
      from: "2026-09-01",
      to: "2026-10-01",
      label: "This Month",
    });
  });

  it("last 3 months, no year boundary", () => {
    expect(getPeriodRange("3m", "2026-09-01")).toEqual({
      from: "2026-07-01",
      to: "2026-10-01",
      label: "Last 3 Months",
    });
  });

  it("last 3 months crosses a year boundary", () => {
    expect(getPeriodRange("3m", "2026-02-01")).toEqual({
      from: "2025-12-01",
      to: "2026-03-01",
      label: "Last 3 Months",
    });
  });

  it("last 6 months crosses a year boundary", () => {
    expect(getPeriodRange("6m", "2026-02-01")).toEqual({
      from: "2025-09-01",
      to: "2026-03-01",
      label: "Last 6 Months",
    });
  });

  it("this year", () => {
    expect(getPeriodRange("year", "2026-09-01")).toEqual({
      from: "2026-01-01",
      to: "2027-01-01",
      label: "This Year",
    });
  });

  it("all time has no bounds", () => {
    expect(getPeriodRange("all", "2026-09-01")).toEqual({
      from: null,
      to: null,
      label: "All Time",
    });
  });

  it("an arbitrary past year", () => {
    expect(getPeriodRange("y2023", "2026-09-01")).toEqual({
      from: "2023-01-01",
      to: "2024-01-01",
      label: "2023",
    });
  });

  it("falls back to this month for an unrecognized key", () => {
    expect(getPeriodRange("bogus", "2026-09-01")).toEqual({
      from: "2026-09-01",
      to: "2026-10-01",
      label: "This Month",
    });
  });
});

describe("yearFromPeriodKey / yearPeriodKey", () => {
  it("round-trips a year", () => {
    expect(yearFromPeriodKey(yearPeriodKey(2022))).toBe(2022);
  });

  it("returns null for a non-year key", () => {
    expect(yearFromPeriodKey("month")).toBeNull();
    expect(yearFromPeriodKey("all")).toBeNull();
  });
});
