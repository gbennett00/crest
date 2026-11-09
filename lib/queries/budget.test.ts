import { describe, expect, it } from "vitest";
import type { BudgetData } from "@/lib/budget/types";
import type { HomeData } from "@/lib/budget/load-home-view";
import { assignmentPatch, snoozePatch, type BudgetViewResponse } from "./budget";

const MONTH = "2026-11-01";

function budget(diningAssigned: number, diningAvailable: number): BudgetData {
  return {
    month: MONTH,
    minMonth: MONTH,
    maxMonth: MONTH,
    rtaAvailableCents: 10_000,
    rtaBreakdown: {
      leftoverFromPriorCents: 0,
      inflowThisMonthCents: 10_000,
      assignedThisMonthCents: 0,
      previousMonthCashOverspendCents: 0,
      assignedFutureCents: 0,
      futureCoveredByFutureIncomeCents: 0,
      totalCents: 10_000,
    },
    groups: [
      {
        id: "everyday",
        name: "Everyday",
        budgetMode: "category",
        isPinned: false,
        groupAssignedCents: 0,
        groupActivityCents: 0,
        groupAvailableCents: diningAvailable,
        target: null,
        categories: [
          {
            id: "dining",
            name: "Dining",
            role: null,
            isPinned: true,
            isHidden: false,
            assignedCents: diningAssigned,
            activityCents: diningAvailable - diningAssigned,
            availableCents: diningAvailable,
            target: null,
            isPaymentCategory: false,
            cardRegisterBalanceCents: null,
            cardActivityBreakdown: null,
          },
        ],
      },
    ],
  };
}

const target = (assignedCents: number) => [{ unit: { type: "category" as const, id: "dining" }, assignedCents }];

describe("assignmentPatch", () => {
  it("patches that month's budget view only", () => {
    const view = { data: budget(0, -2_000), accounts: [], categories: [] } satisfies BudgetViewResponse;
    const patch = assignmentPatch(MONTH, target(2_000));
    const patched = patch(["ledger", "budget-view", MONTH], view) as BudgetViewResponse;
    expect(patched.data.groups[0].categories[0].availableCents).toBe(0);
    expect(patch(["ledger", "budget-view", "2026-10-01"], view)).toBe(view);
  });

  it("re-derives Home's overspent and pinned lists", () => {
    const data = budget(0, -2_000);
    const home = {
      budgetData: data,
      overspent: [{ id: "dining" }],
      pinned: [{ id: "dining", availableCents: -2_000 }],
      pending: [],
      accounts: [],
      categories: [],
    } as unknown as HomeData;
    const patched = assignmentPatch(MONTH, target(2_000))(["ledger", "home-view"], home) as HomeData;
    expect(patched.budgetData.rtaAvailableCents).toBe(8_000);
    expect(patched.overspent).toEqual([]);
    expect(patched.pinned).toMatchObject([{ id: "dining", availableCents: 0 }]);
  });

  it("leaves other queries alone", () => {
    const data = { txns: [] };
    expect(assignmentPatch(MONTH, target(1))(["ledger", "all-transactions", {}], data)).toBe(data);
  });
});

describe("snoozePatch", () => {
  const withTarget = () => {
    const data = budget(5_000, 5_000);
    data.groups[0].categories[0].target = { type: "fill_up_to", amountCents: 5_000, targetDate: null, repeatIntervalMonths: null };
    return data;
  };
  const dining = (data: BudgetData) => data.groups[0].categories[0].target?.snoozedMonth;

  it("snoozes the target in every cached month's budget view", () => {
    const patch = snoozePatch("category", "dining", MONTH);
    for (const month of [MONTH, "2026-12-01"]) {
      const view = { data: withTarget(), accounts: [], categories: [] } satisfies BudgetViewResponse;
      expect(dining((patch(["ledger", "budget-view", month], view) as BudgetViewResponse).data)).toBe(MONTH);
    }
  });

  it("snoozes it in Home's budget data", () => {
    const home = { budgetData: withTarget() } as unknown as HomeData;
    const patched = snoozePatch("category", "dining", MONTH)(["ledger", "home-view"], home) as HomeData;
    expect(dining(patched.budgetData)).toBe(MONTH);
  });

  it("returns data it doesn't change as the same object", () => {
    const view = { data: budget(0, 0), accounts: [], categories: [] } satisfies BudgetViewResponse;
    expect(snoozePatch("category", "dining", MONTH)(["ledger", "budget-view", MONTH], view)).toBe(view);
    const other = { txns: [] };
    expect(snoozePatch("category", "dining", MONTH)(["ledger", "all-transactions", {}], other)).toBe(other);
  });
});
