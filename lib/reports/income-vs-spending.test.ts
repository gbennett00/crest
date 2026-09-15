import { describe, expect, it } from "vitest";
import { aggregateIncomeVsSpending, incomeVsSpendingInsight } from "./income-vs-spending";

const MONTHS = ["2026-07-01", "2026-08-01", "2026-09-01"];
const RTA = "rta-id";

describe("aggregateIncomeVsSpending", () => {
  it("splits RTA inflow as income and everything else as spending", () => {
    const rows = aggregateIncomeVsSpending(
      [
        { category_id: RTA, month: "2026-07-01", activity_cents: 500_000 },
        { category_id: "groceries", month: "2026-07-01", activity_cents: -20_000 },
        { category_id: "rent", month: "2026-07-01", activity_cents: -120_000 },
      ],
      MONTHS,
      RTA,
    );

    expect(rows).toEqual([
      { month: "2026-07-01", incomeCents: 500_000, spendingCents: 140_000 },
      { month: "2026-08-01", incomeCents: 0, spendingCents: 0 },
      { month: "2026-09-01", incomeCents: 0, spendingCents: 0 },
    ]);
  });

  it("clamps a negative RTA net to zero income instead of going negative", () => {
    const rows = aggregateIncomeVsSpending(
      [{ category_id: RTA, month: "2026-07-01", activity_cents: -1_000 }],
      MONTHS,
      RTA,
    );
    expect(rows[0]).toEqual({ month: "2026-07-01", incomeCents: 0, spendingCents: 0 });
  });

  it("clamps net-refund months to zero spending instead of going negative", () => {
    const rows = aggregateIncomeVsSpending(
      [{ category_id: "groceries", month: "2026-07-01", activity_cents: 5_000 }],
      MONTHS,
      RTA,
    );
    expect(rows[0]).toEqual({ month: "2026-07-01", incomeCents: 0, spendingCents: 0 });
  });

  it("ignores activity outside the requested months", () => {
    const rows = aggregateIncomeVsSpending(
      [{ category_id: RTA, month: "2025-01-01", activity_cents: 500_000 }],
      MONTHS,
      RTA,
    );
    expect(rows.every((r) => r.incomeCents === 0)).toBe(true);
  });

  it("treats everything as spending when there's no Ready to Assign category", () => {
    const rows = aggregateIncomeVsSpending(
      [{ category_id: "groceries", month: "2026-07-01", activity_cents: -1_000 }],
      MONTHS,
      null,
    );
    expect(rows[0]).toEqual({ month: "2026-07-01", incomeCents: 0, spendingCents: 1_000 });
  });
});

describe("incomeVsSpendingInsight", () => {
  it("reads as roughly equal within 5%", () => {
    const rows = [
      { month: "2026-07-01", incomeCents: 500_000, spendingCents: 490_000 },
      { month: "2026-08-01", incomeCents: 500_000, spendingCents: 510_000 },
    ];
    expect(incomeVsSpendingInsight(rows)).toBe("On average, you're spending about as much as you make.");
  });

  it("reads as spending less", () => {
    const rows = [{ month: "2026-07-01", incomeCents: 500_000, spendingCents: 300_000 }];
    expect(incomeVsSpendingInsight(rows)).toBe("On average, you're spending less than you make.");
  });

  it("reads as spending more", () => {
    const rows = [{ month: "2026-07-01", incomeCents: 300_000, spendingCents: 500_000 }];
    expect(incomeVsSpendingInsight(rows)).toBe("On average, you're spending more than you make.");
  });

  it("handles no activity", () => {
    expect(incomeVsSpendingInsight([])).toBe("No activity yet.");
    expect(
      incomeVsSpendingInsight([{ month: "2026-07-01", incomeCents: 0, spendingCents: 0 }]),
    ).toBe("No activity yet.");
  });
});
