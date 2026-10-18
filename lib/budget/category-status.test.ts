import { describe, expect, it } from "vitest";
import { categoryPillState } from "./category-status";
import type { BudgetCategory, TargetData } from "./types";

const MONTH = "2026-10-01";

function cat(overrides: Partial<BudgetCategory> = {}): BudgetCategory {
  return {
    id: "c1",
    name: "Groceries",
    role: null,
    isPinned: false,
    isHidden: false,
    assignedCents: 0,
    activityCents: 0,
    availableCents: 0,
    target: null,
    isPaymentCategory: false,
    cardRegisterBalanceCents: null,
    cardActivityBreakdown: null,
    ...overrides,
  };
}

const fillUpTo = (amountCents: number): TargetData => ({
  type: "fill_up_to",
  amountCents,
  targetDate: null,
  repeatIntervalMonths: null,
});

describe("categoryPillState", () => {
  it("is neg when overspent, even with an unmet target", () => {
    expect(categoryPillState(cat({ availableCents: -1_431, target: fillUpTo(50_000) }), MONTH)).toBe("neg");
  });

  it("is pos when funded with no target", () => {
    expect(categoryPillState(cat({ availableCents: 12_992 }), MONTH)).toBe("pos");
  });

  it("is zero at exactly zero with nothing outstanding", () => {
    expect(categoryPillState(cat(), MONTH)).toBe("zero");
  });

  it("is warn when funded but short of its target", () => {
    expect(categoryPillState(cat({ availableCents: 900, target: fillUpTo(10_700) }), MONTH)).toBe("warn");
  });

  it("is pos once the target is met", () => {
    expect(categoryPillState(cat({ availableCents: 10_700, target: fillUpTo(10_700) }), MONTH)).toBe("pos");
  });

  it("is warn when zero but the target still asks for money", () => {
    expect(categoryPillState(cat({ target: fillUpTo(10_700) }), MONTH)).toBe("warn");
  });

  it("is warn when a card's payment category doesn't cover its debt", () => {
    expect(
      categoryPillState(
        cat({ isPaymentCategory: true, availableCents: 20_000, cardRegisterBalanceCents: -50_000 }),
        MONTH,
      ),
    ).toBe("warn");
  });

  it("is pos when a card's payment category covers its debt", () => {
    expect(
      categoryPillState(
        cat({ isPaymentCategory: true, availableCents: 50_000, cardRegisterBalanceCents: -50_000 }),
        MONTH,
      ),
    ).toBe("pos");
  });
});
