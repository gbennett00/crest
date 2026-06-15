import { describe, expect, it } from "vitest";

import type { BudgetCategory, BudgetData, BudgetGroup } from "./types";
import { selectBudgetItems, selectOverspent, selectPinned } from "./selectors";

function cat(partial: Partial<BudgetCategory> & { id: string; name: string }): BudgetCategory {
  return {
    role: null,
    isPinned: false,
    isHidden: false,
    assignedCents: 0,
    activityCents: 0,
    availableCents: 0,
    target: null,
    cardRegisterBalanceCents: null,
    ...partial,
  };
}

function group(partial: Partial<BudgetGroup> & { id: string; name: string }): BudgetGroup {
  return {
    budgetMode: "category",
    isPinned: false,
    categories: [],
    groupAssignedCents: 0,
    groupActivityCents: 0,
    groupAvailableCents: 0,
    target: null,
    ...partial,
  };
}

function data(groups: BudgetGroup[]): BudgetData {
  return {
    month: "2026-06-01",
    minMonth: "2026-06-01",
    maxMonth: "2026-07-01",
    rtaAvailableCents: 0,
    groups,
  };
}

describe("selectBudgetItems", () => {
  it("flattens category-mode groups into one item per visible category", () => {
    const items = selectBudgetItems(
      data([
        group({
          id: "g1",
          name: "Bills",
          categories: [
            cat({ id: "c1", name: "Rent", availableCents: 100_00 }),
            cat({ id: "c2", name: "Water", availableCents: -5_00 }),
          ],
        }),
      ]),
    );
    expect(items.map((i) => i.id)).toEqual(["c1", "c2"]);
    expect(items.every((i) => !i.isGroup)).toBe(true);
  });

  it("emits a single group item for group-budgeting mode", () => {
    const items = selectBudgetItems(
      data([
        group({
          id: "g1",
          name: "Vacations",
          budgetMode: "group",
          groupAvailableCents: 300_00,
          categories: [cat({ id: "c1", name: "Flights" })],
        }),
      ]),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "g1", isGroup: true, availableCents: 300_00 });
  });

  it("excludes hidden and ready-to-assign categories", () => {
    const items = selectBudgetItems(
      data([
        group({
          id: "g1",
          name: "Inflows",
          categories: [
            cat({ id: "rta", name: "RTA", role: "ready_to_assign" }),
            cat({ id: "hidden", name: "Old", isHidden: true }),
            cat({ id: "c1", name: "Groceries" }),
          ],
        }),
      ]),
    );
    expect(items.map((i) => i.id)).toEqual(["c1"]);
  });

  it("inherits pin state from the group for category-mode rows", () => {
    const items = selectBudgetItems(
      data([
        group({
          id: "g1",
          name: "Bills",
          isPinned: true,
          categories: [cat({ id: "c1", name: "Rent", isPinned: false })],
        }),
      ]),
    );
    expect(items[0].isPinned).toBe(true);
  });
});

describe("selectOverspent", () => {
  it("returns only negative lines, most-overspent first", () => {
    const result = selectOverspent(
      data([
        group({
          id: "g1",
          name: "Bills",
          categories: [
            cat({ id: "c1", name: "A", availableCents: -5_00 }),
            cat({ id: "c2", name: "B", availableCents: 10_00 }),
            cat({ id: "c3", name: "C", availableCents: -20_00 }),
          ],
        }),
      ]),
    );
    expect(result.map((i) => i.id)).toEqual(["c3", "c1"]);
  });
});

describe("selectPinned", () => {
  it("returns pinned lines sorted by group then name", () => {
    const result = selectPinned(
      data([
        group({
          id: "g2",
          name: "Zebra",
          categories: [cat({ id: "z1", name: "Apple", isPinned: true })],
        }),
        group({
          id: "g1",
          name: "Alpha",
          categories: [
            cat({ id: "a2", name: "Banana", isPinned: true }),
            cat({ id: "a1", name: "Apple", isPinned: true }),
            cat({ id: "a3", name: "Cherry", isPinned: false }),
          ],
        }),
      ]),
    );
    expect(result.map((i) => i.id)).toEqual(["a1", "a2", "z1"]);
  });
});
