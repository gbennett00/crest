import { describe, expect, it } from "vitest";
import { computeNetWorthSeries } from "./net-worth";

const MONTHS = ["2026-07-01", "2026-08-01", "2026-09-01"];

describe("computeNetWorthSeries", () => {
  it("carries a balance forward through months with no activity", () => {
    const series = computeNetWorthSeries(
      [{ account_id: "checking", month: "2026-07-01", balance_cents: 100_000 }],
      ["checking"],
      MONTHS,
    );
    expect(series).toEqual([
      { month: "2026-07-01", assetsCents: 100_000, debtsCents: 0, netCents: 100_000 },
      { month: "2026-08-01", assetsCents: 100_000, debtsCents: 0, netCents: 100_000 },
      { month: "2026-09-01", assetsCents: 100_000, debtsCents: 0, netCents: 100_000 },
    ]);
  });

  it("splits negative balances into debts, positive into assets", () => {
    const series = computeNetWorthSeries(
      [
        { account_id: "checking", month: "2026-07-01", balance_cents: 100_000 },
        { account_id: "credit", month: "2026-07-01", balance_cents: -20_000 },
      ],
      ["checking", "credit"],
      ["2026-07-01"],
    );
    expect(series).toEqual([
      { month: "2026-07-01", assetsCents: 100_000, debtsCents: -20_000, netCents: 80_000 },
    ]);
  });

  it("updates as later months' activity lands", () => {
    const series = computeNetWorthSeries(
      [
        { account_id: "checking", month: "2026-07-01", balance_cents: 100_000 },
        { account_id: "checking", month: "2026-09-01", balance_cents: 150_000 },
      ],
      ["checking"],
      MONTHS,
    );
    expect(series.map((p) => p.assetsCents)).toEqual([100_000, 100_000, 150_000]);
  });

  it("treats an account with no rows yet as a zero balance", () => {
    const series = computeNetWorthSeries([], ["checking"], MONTHS);
    expect(series.every((p) => p.netCents === 0)).toBe(true);
  });

  it("ignores rows for accounts not in accountIds (e.g. a closed account)", () => {
    const series = computeNetWorthSeries(
      [{ account_id: "closed-account", month: "2026-07-01", balance_cents: 999_999 }],
      ["checking"],
      MONTHS,
    );
    expect(series.every((p) => p.netCents === 0)).toBe(true);
  });
});
