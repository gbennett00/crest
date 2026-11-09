import { describe, expect, it } from "vitest";
import { withTargetSnoozed } from "./snooze";
import type { BudgetCategory, BudgetData, BudgetGroup, TargetData } from "./types";

const MONTH = "2026-11-01";

const target: TargetData = {
  type: "fill_up_to",
  amountCents: 50_000,
  targetDate: null,
  repeatIntervalMonths: null,
};

const cat = (id: string, t: TargetData | null): BudgetCategory => ({
  id,
  name: id,
  role: null,
  isPinned: false,
  isHidden: false,
  assignedCents: 0,
  activityCents: 0,
  availableCents: 0,
  target: t,
  isPaymentCategory: false,
  cardRegisterBalanceCents: null,
  cardActivityBreakdown: null,
});

const group = (id: string, categories: BudgetCategory[], t: TargetData | null = null): BudgetGroup => ({
  id,
  name: id,
  budgetMode: "category",
  isPinned: false,
  categories,
  groupAssignedCents: 0,
  groupActivityCents: 0,
  groupAvailableCents: 0,
  target: t,
});

const data = (groups: BudgetGroup[]) => ({ month: MONTH, groups }) as BudgetData;

describe("withTargetSnoozed", () => {
  it("snoozes only the matching category's target", () => {
    const before = data([group("g1", [cat("a", target), cat("b", target)])]);
    const after = withTargetSnoozed(before, "category", "a", MONTH);
    expect(after.groups[0].categories[0].target?.snoozedMonth).toBe(MONTH);
    expect(after.groups[0].categories[1].target?.snoozedMonth).toBeUndefined();
  });

  it("snoozes a group's target", () => {
    const after = withTargetSnoozed(data([group("g1", [], target)]), "group", "g1", MONTH);
    expect(after.groups[0].target?.snoozedMonth).toBe(MONTH);
  });

  it("unsnoozes with null", () => {
    const snoozed = { ...target, snoozedMonth: MONTH };
    const after = withTargetSnoozed(data([group("g1", [cat("a", snoozed)])]), "category", "a", null);
    expect(after.groups[0].categories[0].target?.snoozedMonth).toBeNull();
  });

  it("leaves a category with no target alone and does not mutate the input", () => {
    const before = data([group("g1", [cat("a", null)])]);
    const after = withTargetSnoozed(before, "category", "a", MONTH);
    expect(after.groups[0].categories[0].target).toBeNull();
    const withTarget = data([group("g1", [cat("a", target)])]);
    withTargetSnoozed(withTarget, "category", "a", MONTH);
    expect(withTarget.groups[0].categories[0].target?.snoozedMonth).toBeUndefined();
  });

  it("returns the same object when nothing changes", () => {
    const snoozed = data([group("g1", [cat("a", { ...target, snoozedMonth: MONTH })])]);
    expect(withTargetSnoozed(snoozed, "category", "a", MONTH)).toBe(snoozed);
    const noTarget = data([group("g1", [cat("a", null)])]);
    expect(withTargetSnoozed(noTarget, "category", "a", MONTH)).toBe(noTarget);
    expect(withTargetSnoozed(noTarget, "group", "missing", MONTH)).toBe(noTarget);
  });
});
