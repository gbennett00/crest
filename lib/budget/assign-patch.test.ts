import { describe, expect, it } from "vitest";
import { READY_TO_ASSIGN } from "@/lib/ledger";
import { targetsForMoves, withAssignments } from "./assign-patch";
import type { BudgetCategory, BudgetData, BudgetGroup } from "./types";

const MONTH = "2026-11-01";

function cat(id: string, assignedCents: number, availableCents: number): BudgetCategory {
  return {
    id,
    name: id,
    role: null,
    isPinned: false,
    isHidden: false,
    assignedCents,
    activityCents: availableCents - assignedCents,
    availableCents,
    target: null,
    isPaymentCategory: false,
    cardRegisterBalanceCents: null,
    cardActivityBreakdown: null,
  };
}

function group(
  id: string,
  categories: BudgetCategory[],
  overrides: Partial<BudgetGroup> = {},
): BudgetGroup {
  return {
    id,
    name: id,
    budgetMode: "category",
    isPinned: false,
    categories,
    groupAssignedCents: 0,
    groupActivityCents: 0,
    groupAvailableCents: categories.reduce((s, c) => s + c.availableCents, 0),
    target: null,
    ...overrides,
  };
}

function budget(groups: BudgetGroup[], rtaCents = 100_000): BudgetData {
  return {
    month: MONTH,
    minMonth: "2026-01-01",
    maxMonth: "2026-12-01",
    rtaAvailableCents: rtaCents,
    rtaBreakdown: {
      leftoverFromPriorCents: 0,
      inflowThisMonthCents: rtaCents + 20_000,
      assignedThisMonthCents: 20_000,
      previousMonthCashOverspendCents: 0,
      assignedFutureCents: 0,
      futureCoveredByFutureIncomeCents: 0,
      totalCents: rtaCents,
    },
    groups,
  };
}

const data = budget([
  group("everyday", [cat("groceries", 15_000, 12_000), cat("dining", 5_000, -1_000)]),
  group("bills", [cat("rent", 0, 0), cat("power", 0, 0)], {
    budgetMode: "group",
    groupAssignedCents: 0,
    groupAvailableCents: 3_000,
  }),
]);

const category = (id: string) => ({ type: "category" as const, id });
const groupUnit = (id: string) => ({ type: "group" as const, id });

describe("withAssignments", () => {
  it("moves a category's assigned and available, its group subtotal and Ready to Assign by the change", () => {
    const next = withAssignments(data, MONTH, [{ unit: category("groceries"), assignedCents: 20_000 }]);
    const everyday = next.groups[0];
    expect(everyday.categories[0]).toMatchObject({ assignedCents: 20_000, availableCents: 17_000 });
    expect(everyday.groupAvailableCents).toBe(16_000);
    expect(next.rtaAvailableCents).toBe(95_000);
    expect(next.rtaBreakdown).toMatchObject({ assignedThisMonthCents: 25_000, totalCents: 95_000 });
  });

  it("returns money to Ready to Assign when an assignment shrinks", () => {
    const next = withAssignments(data, MONTH, [{ unit: category("groceries"), assignedCents: 10_000 }]);
    expect(next.groups[0].categories[0].availableCents).toBe(7_000);
    expect(next.rtaAvailableCents).toBe(105_000);
  });

  it("covers an overspent category from negative available", () => {
    const next = withAssignments(data, MONTH, [{ unit: category("dining"), assignedCents: 6_000 }]);
    expect(next.groups[0].categories[1].availableCents).toBe(0);
  });

  it("assigns a group-budgeted group at the group level", () => {
    const next = withAssignments(data, MONTH, [{ unit: groupUnit("bills"), assignedCents: 4_000 }]);
    expect(next.groups[1]).toMatchObject({ groupAssignedCents: 4_000, groupAvailableCents: 7_000 });
    expect(next.rtaAvailableCents).toBe(96_000);
  });

  it("leaves a group-budgeted group's own available alone when a member category changes", () => {
    const next = withAssignments(data, MONTH, [{ unit: category("rent"), assignedCents: 1_000 }]);
    expect(next.groups[1].groupAvailableCents).toBe(3_000);
  });

  it("applies several targets", () => {
    const next = withAssignments(data, MONTH, [
      { unit: category("groceries"), assignedCents: 16_000 },
      { unit: category("dining"), assignedCents: 7_000 },
    ]);
    expect(next.rtaAvailableCents).toBe(97_000);
    expect(next.groups[0].groupAvailableCents).toBe(14_000);
  });

  it("is unchanged when applied again (the write is already in the data)", () => {
    const targets = [{ unit: category("groceries"), assignedCents: 20_000 }];
    const once = withAssignments(data, MONTH, targets);
    expect(withAssignments(once, MONTH, targets)).toBe(once);
  });

  it("leaves another month, an unknown unit, or an unchanged amount as the same object", () => {
    expect(withAssignments(data, "2026-10-01", [{ unit: category("groceries"), assignedCents: 1 }])).toBe(data);
    expect(withAssignments(data, MONTH, [{ unit: category("nope"), assignedCents: 1 }])).toBe(data);
    expect(withAssignments(data, MONTH, [{ unit: category("groceries"), assignedCents: 15_000 }])).toBe(data);
  });
});

describe("targetsForMoves", () => {
  it("turns a move between units into both units' new amounts", () => {
    expect(
      targetsForMoves(data, [
        { month: MONTH, from: category("groceries"), to: category("dining"), amountCents: 1_000 },
      ]),
    ).toEqual([
      { unit: category("groceries"), assignedCents: 14_000 },
      { unit: category("dining"), assignedCents: 6_000 },
    ]);
  });

  it("keeps Ready to Assign out of the targets", () => {
    expect(
      targetsForMoves(data, [
        { month: MONTH, from: READY_TO_ASSIGN, to: category("dining"), amountCents: 1_000 },
        { month: MONTH, from: groupUnit("bills"), to: READY_TO_ASSIGN, amountCents: 500 },
      ]),
    ).toEqual([
      { unit: category("dining"), assignedCents: 6_000 },
      { unit: groupUnit("bills"), assignedCents: -500 },
    ]);
  });

  it("accumulates several moves into one unit (covering overspending)", () => {
    const targets = targetsForMoves(data, [
      { month: MONTH, from: READY_TO_ASSIGN, to: category("dining"), amountCents: 400 },
      { month: MONTH, from: category("groceries"), to: category("dining"), amountCents: 600 },
    ]);
    expect(targets).toEqual([
      { unit: category("dining"), assignedCents: 6_000 },
      { unit: category("groceries"), assignedCents: 14_400 },
    ]);
    // Net effect on Ready to Assign is only the 400 it gave.
    expect(withAssignments(data, MONTH, targets).rtaAvailableCents).toBe(99_600);
  });
});
