import { describe, expect, it } from "vitest";

import { READY_TO_ASSIGN } from "@/lib/ledger";
import { buildMoveOptions, resolveMoveMoney, RTA_MOVE_KEY, unitKey } from "./move-money";
import type { BudgetData } from "./types";

function makeData(): BudgetData {
  return {
    month: "2026-09-01",
    rtaAvailableCents: 50000,
    groups: [
      {
        id: "grp-bills",
        name: "Bills",
        budgetMode: "category",
        groupAssignedCents: 0,
        groupAvailableCents: 0,
        target: null,
        categories: [
          { id: "rta", name: "Ready to Assign", role: "ready_to_assign", isHidden: false, assignedCents: 0, availableCents: 0, target: null },
          { id: "rent", name: "Rent", role: null, isHidden: false, assignedCents: 150000, availableCents: 147000, target: null },
          { id: "old", name: "Old", role: null, isHidden: true, assignedCents: 0, availableCents: 0, target: null },
        ],
      },
      {
        id: "grp-fun",
        name: "Fun",
        budgetMode: "group",
        groupAssignedCents: 5000,
        groupAvailableCents: -1200,
        target: null,
        categories: [
          { id: "dining", name: "Dining", role: null, isHidden: false, assignedCents: 0, availableCents: 0, target: null },
        ],
      },
    ],
  } as unknown as BudgetData;
}

describe("buildMoveOptions", () => {
  it("lists Ready to Assign first, then funding units with their available", () => {
    expect(buildMoveOptions(makeData())).toEqual([
      { id: RTA_MOVE_KEY, name: "Ready to Assign", groupName: "— Ready to Assign —", availableCents: 50000 },
      { id: "c:rent", name: "Rent", groupName: "Bills", availableCents: 147000 },
      { id: "g:grp-fun", name: "Fun", groupName: "Group budget", availableCents: -1200 },
    ]);
  });
});

describe("unitKey", () => {
  it("matches the option ids", () => {
    expect(unitKey({ type: "category", id: "rent" })).toBe("c:rent");
    expect(unitKey({ type: "group", id: "grp-fun" })).toBe("g:grp-fun");
  });
});

describe("resolveMoveMoney", () => {
  const base = { month: "2026-09-01", amountCents: 2500 };

  it("builds a category -> group move", () => {
    expect(resolveMoveMoney({ ...base, fromKey: "c:rent", toKey: "g:grp-fun" })).toEqual({
      move: {
        month: "2026-09-01",
        from: { type: "category", id: "rent" },
        to: { type: "group", id: "grp-fun" },
        amountCents: 2500,
      },
    });
  });

  it("maps the RTA key to READY_TO_ASSIGN on either side", () => {
    const toRta = resolveMoveMoney({ ...base, fromKey: "c:rent", toKey: RTA_MOVE_KEY });
    expect(toRta).toMatchObject({ move: { to: READY_TO_ASSIGN } });
    const fromRta = resolveMoveMoney({ ...base, fromKey: RTA_MOVE_KEY, toKey: "c:rent" });
    expect(fromRta).toMatchObject({ move: { from: READY_TO_ASSIGN } });
  });

  it("requires both sides", () => {
    expect(resolveMoveMoney({ ...base, fromKey: "c:rent", toKey: null })).toHaveProperty("error");
  });

  it("rejects moving to the same unit", () => {
    expect(resolveMoveMoney({ ...base, fromKey: "c:rent", toKey: "c:rent" })).toHaveProperty("error");
  });

  it.each([0, -100])("rejects a non-positive amount (%i)", (amountCents) => {
    expect(
      resolveMoveMoney({ month: "2026-09-01", fromKey: "c:rent", toKey: "g:grp-fun", amountCents }),
    ).toHaveProperty("error");
  });
});
