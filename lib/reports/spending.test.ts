import { describe, expect, it } from "vitest";
import { aggregateSpending } from "./spending";

const META = new Map([
  ["groceries", { name: "Groceries", groupId: "g1", groupName: "Everyday Expenses" }],
  ["rent", { name: "Rent", groupId: "g2", groupName: "Housing" }],
  ["rta", { name: "Ready to Assign", groupId: "g0", groupName: "Inflows" }],
]);

describe("aggregateSpending", () => {
  it("sums multiple months per category and computes percentages", () => {
    const { totalCents, rows } = aggregateSpending(
      [
        { category_id: "groceries", month: "2026-08-01", activity_cents: -5_000 },
        { category_id: "groceries", month: "2026-09-01", activity_cents: -3_000 },
        { category_id: "rent", month: "2026-09-01", activity_cents: -12_000 },
      ],
      META,
    );

    expect(totalCents).toBe(20_000);
    expect(rows).toEqual([
      {
        categoryId: "rent",
        categoryName: "Rent",
        groupId: "g2",
        groupName: "Housing",
        spentCents: 12_000,
        pct: 60,
      },
      {
        categoryId: "groceries",
        categoryName: "Groceries",
        groupId: "g1",
        groupName: "Everyday Expenses",
        spentCents: 8_000,
        pct: 40,
      },
    ]);
  });

  it("excludes categories that net to zero or a refund (inflow)", () => {
    const { totalCents, rows } = aggregateSpending(
      [
        { category_id: "groceries", month: "2026-09-01", activity_cents: -5_000 },
        { category_id: "groceries", month: "2026-09-01", activity_cents: 5_000 }, // fully refunded
        { category_id: "rent", month: "2026-09-01", activity_cents: 2_000 }, // net inflow
      ],
      META,
    );

    expect(totalCents).toBe(0);
    expect(rows).toEqual([]);
  });

  it("drops categories with no metadata (e.g. Ready to Assign)", () => {
    const { rows } = aggregateSpending(
      [{ category_id: "rta", month: "2026-09-01", activity_cents: -1_000 }],
      new Map(), // RTA never has a meta entry in practice
    );
    expect(rows).toEqual([]);
  });

  it("returns an empty breakdown for no activity", () => {
    expect(aggregateSpending([], META)).toEqual({ totalCents: 0, rows: [] });
  });
});
