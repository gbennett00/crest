// View-model types for the budget and home screens.
//
// These describe the *computed* shape consumed by the UI — never raw DB rows.
// They live here (not in a "use client" component) so both server data-loaders
// and client components can import them without crossing the server/client
// boundary.

export type TargetData = {
  type: "fill_up_to" | "set_aside" | "by_date";
  amountCents: number;
  targetDate: string | null;
};

// YNAB-style activity breakdown for a credit-card payment category, for a single
// (viewed) month. `totalActivityCents === fundedSpendingCents + paymentsAndReturnsCents`
// and equals the payment category's activity for the month.
export type PaymentCategoryBreakdown = {
  spendingCents: number; // gross purchases (negative)
  returnsCents: number; // returns/refunds on the card (positive)
  totalSpendingCents: number; // spending + returns
  fundedSpendingCents: number; // covered portion of spending (positive)
  paymentsAndReturnsCents: number; // -(payments + returns) (negative)
  totalActivityCents: number; // net change to payment available
};

export type BudgetCategory = {
  id: string;
  name: string;
  role: "ready_to_assign" | null;
  isPinned: boolean;
  isHidden: boolean;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
  target: TargetData | null;
  // For credit card payment categories: the card's register balance (negative = debt).
  // When abs(cardRegisterBalance) > availableCents the payment envelope is underfunded.
  cardRegisterBalanceCents: number | null;
  // For credit card payment categories: viewed-month activity breakdown (popover).
  cardActivityBreakdown: PaymentCategoryBreakdown | null;
};

export type BudgetGroup = {
  id: string;
  name: string;
  budgetMode: "category" | "group";
  isPinned: boolean;
  categories: BudgetCategory[];
  groupAssignedCents: number;
  groupActivityCents: number;
  groupAvailableCents: number;
  target: TargetData | null;
};

export type BudgetData = {
  month: string;
  // Inclusive navigation bounds: earliest month with activity → next month.
  minMonth: string;
  maxMonth: string;
  rtaAvailableCents: number;
  groups: BudgetGroup[];
};

// A flattened budget line (category, or whole group in group-budgeting mode)
// used by the home screen's "Overspent" and "Pinned" sections.
export type BudgetViewItem = {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  availableCents: number;
  isPinned: boolean;
  isGroup: boolean;
};
