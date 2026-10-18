import type { PillState } from "@/lib/available-pill";
import type { BudgetCategory } from "./types";
import { paymentShortfallCents, targetNeedCents } from "./compute";

/**
 * State of a category's Available pill on the Plan table.
 *
 * Overspent wins. Otherwise a category needs attention ("warn") when it is
 * short of what it should hold: a credit-card payment category that doesn't
 * cover the card's debt, or a category whose target still asks for money this
 * month. Then exactly zero, else funded.
 */
export function categoryPillState(cat: BudgetCategory, month: string): PillState {
  if (cat.availableCents < 0) return "neg";

  const cardShortfall = paymentShortfallCents(cat.availableCents, cat.cardRegisterBalanceCents);
  const targetNeed = cat.target
    ? targetNeedCents(cat.target, month, cat.assignedCents, cat.availableCents)
    : 0;
  if (cardShortfall > 0 || targetNeed > 0) return "warn";

  return cat.availableCents === 0 ? "zero" : "pos";
}
