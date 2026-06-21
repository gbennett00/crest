// Pure budget calculations — no Supabase, no React, no IO.
//
// `load-budget-view.ts` fetches rows and feeds them through these functions.
// Keeping the math here (and DB-free) makes it the single source of truth for
// both the budget and home screens, and lets it be unit-tested with plain
// integer-cents fixtures.

import { computeAvailableThrough } from "@/lib/ledger";
import type {
  BudgetCategory,
  BudgetGroup,
  PaymentCategoryBreakdown,
  TargetData,
} from "./types";

/** entityId → budget month (YYYY-MM-01) → cents. */
export type MonthlyCents = Record<string, Record<string, number>>;

/** A normalized `<entity, month, cents>` row, agnostic to its DB source view. */
export type HistoryRow = { id: string; month: string; cents: number };

/** Collapse flat history rows into a nested `id → month → cents` map. */
export function buildHistory(rows: HistoryRow[]): MonthlyCents {
  const map: MonthlyCents = {};
  for (const row of rows) {
    (map[row.id] ??= {})[row.month] = row.cents;
  }
  return map;
}

/**
 * A credit-card transaction, normalized for payment-category math. One row per
 * transaction on a credit card. Opening-balance transactions are excluded
 * upstream (they are part of the register balance, not derived activity).
 *
 * Sign convention follows the ledger: negative = outflow (purchase / transfer
 * out), positive = inflow (return / payment to the card).
 *
 * `approved` matters because budget read-models (and therefore funded spending)
 * only count approved activity. An **unapproved** purchase still adds to the
 * card's debt (register balance) and to gross spending, but contributes **no**
 * funded spending — so it surfaces as underfunded until approved and funded.
 */
export type CreditTxn = {
  /** Payment category of the card this transaction is on. */
  paymentCategoryId: string;
  /** Budget month (YYYY-MM-01) of the transaction. */
  month: string;
  /** Signed transaction total. */
  amountCents: number;
  /** A transfer (e.g. a payment to the card), not a purchase/return. */
  isTransfer: boolean;
  /** Whether the transaction is approved (only approved activity is funded). */
  approved: boolean;
  /** Spending-category allocations (signed); empty when uncategorized. */
  allocations: { categoryId: string; amountCents: number }[];
};

/**
 * Cents of a credit card's debt not covered by its payment category — the
 * amount still needed to fully fund the payment. Returns 0 for non-payment
 * categories, cards in credit (no debt), or fully-covered payment categories.
 * The single source of truth for the underfunded (amber) state and the
 * one-click "assign to cover" amount.
 */
export function paymentShortfallCents(
  availableCents: number,
  cardRegisterBalanceCents: number | null,
): number {
  if (cardRegisterBalanceCents === null || cardRegisterBalanceCents >= 0) return 0;
  return Math.max(0, Math.abs(cardRegisterBalanceCents) - availableCents);
}

/**
 * Distribute an integer-cents `total` across keys weighted by `weights`,
 * preserving the exact integer sum via largest-remainder rounding.
 */
function distributeProportionally(
  total: number,
  weights: Record<string, number>,
): Map<string, number> {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const result = new Map<string, number>();
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  if (sum === 0) return result;

  let allocated = 0;
  const fracs: { key: string; frac: number }[] = [];
  for (const [key, w] of entries) {
    const exact = (total * w) / sum;
    const floor = Math.floor(exact);
    result.set(key, floor);
    allocated += floor;
    fracs.push({ key, frac: exact - floor });
  }
  fracs.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < total - allocated; i++) {
    const k = fracs[i % fracs.length].key;
    result.set(k, (result.get(k) ?? 0) + 1);
  }
  return result;
}

/**
 * Derive each credit-card payment category's activity from the card register,
 * YNAB-style: the payment envelope is filled only by *funded* spending (the
 * portion a spending category actually had money to cover), and is drained by
 * card payments and returns.
 *
 * For a spending category in a month, funds available before its credit
 * purchases = its rolled-forward available + the month's credit outflow (adding
 * the outflow back recovers the pre-purchase balance, and that balance already
 * includes any assignments, cash spending, and returns). The funded portion is
 * capped at those funds; any excess is uncovered debt that surfaces as an
 * underfunded payment category. Funded spending is attributed to each card's
 * payment category in proportion to that card's share of the category's outflow.
 *
 * Returns `paymentActivity` (payment category → month → cents, to be merged into
 * the spending-category activity map so availability rolls it forward) and a
 * per-payment-category breakdown of the viewed month for the UI popover.
 */
export function computePaymentCategoryActivity(params: {
  throughMonth: string;
  catActivity: MonthlyCents;
  catAssigned: MonthlyCents;
  grpActivity?: MonthlyCents;
  grpAssigned?: MonthlyCents;
  /**
   * categoryId → its group and budget mode. Categories in a group-budgeted
   * group are funded at the group level, so their funding cap is assessed on the
   * group's available, not the (always-negative) per-category available.
   */
  categoryGroup?: Map<string, { groupId: string; mode: "category" | "group" }>;
  creditTxns: CreditTxn[];
}): {
  paymentActivity: MonthlyCents;
  breakdown: Record<string, PaymentCategoryBreakdown>;
} {
  const { throughMonth, catActivity, catAssigned, creditTxns } = params;
  const grpActivity = params.grpActivity ?? {};
  const grpAssigned = params.grpAssigned ?? {};
  const categoryGroup = params.categoryGroup ?? new Map();

  // payCat → month → cents. Spending is GROSS (all purchases, incl. unapproved
  // / uncategorized) since it mirrors register movement. Returns and payments
  // are approved only (they drain the payment envelope).
  const spendingByPay: MonthlyCents = {};
  const returnsByPay: MonthlyCents = {};
  const paymentsByPay: MonthlyCents = {};

  // A "funding unit" is the category itself, or its group when the group is
  // budgeted at the group level. The funding cap is assessed per unit.
  // unitId → month → total outflow magnitude; and → month → payCat → magnitude.
  const outflowByUnit: Record<string, Record<string, number>> = {};
  const outflowByUnitPay: Record<string, Record<string, Record<string, number>>> = {};
  // unitId → the activity/assigned histories to roll forward for the cap.
  const unitHistory: Record<
    string,
    { activity: Record<string, number>; assigned: Record<string, number> }
  > = {};

  const add = (map: MonthlyCents, key: string, month: string, cents: number) => {
    (map[key] ??= {})[month] = (map[key]?.[month] ?? 0) + cents;
  };

  for (const txn of creditTxns) {
    if (txn.month > throughMonth) continue;
    const pay = txn.paymentCategoryId;

    if (txn.isTransfer) {
      // A payment to the card (transfer inflow) drains the payment envelope.
      if (txn.amountCents > 0) add(paymentsByPay, pay, txn.month, txn.amountCents);
      continue;
    }

    if (txn.amountCents < 0) {
      // Purchase: gross spending always counts; funded spending only when
      // approved (and capped at the funding unit's available below).
      add(spendingByPay, pay, txn.month, -txn.amountCents);
      if (!txn.approved) continue;
      for (const alloc of txn.allocations) {
        if (alloc.amountCents >= 0) continue; // only outflow portions fund
        const mag = -alloc.amountCents;
        const cg = categoryGroup.get(alloc.categoryId);
        const unitId = cg?.mode === "group" ? `g:${cg.groupId}` : `c:${alloc.categoryId}`;
        unitHistory[unitId] ??=
          cg?.mode === "group"
            ? { activity: grpActivity[cg.groupId] ?? {}, assigned: grpAssigned[cg.groupId] ?? {} }
            : {
                activity: catActivity[alloc.categoryId] ?? {},
                assigned: catAssigned[alloc.categoryId] ?? {},
              };
        add(outflowByUnit, unitId, txn.month, mag);
        const byPay = ((outflowByUnitPay[unitId] ??= {})[txn.month] ??= {});
        byPay[pay] = (byPay[pay] ?? 0) + mag;
      }
    } else if (txn.amountCents > 0 && txn.approved) {
      // Return/refund: drains the payment envelope (the debt it covered shrank).
      add(returnsByPay, pay, txn.month, txn.amountCents);
    }
  }

  // Funded spending: cap each funding unit's credit outflow at the funds on
  // hand, then attribute it across the cards it was spent on.
  const fundedByPay: MonthlyCents = {};
  for (const unitId of Object.keys(outflowByUnit)) {
    const { activity, assigned } = unitHistory[unitId];
    for (const month of Object.keys(outflowByUnit[unitId])) {
      const out = outflowByUnit[unitId][month];
      if (out <= 0) continue;
      const availThrough = computeAvailableThrough(month, activity, assigned);
      const funded = Math.max(0, Math.min(out, availThrough + out));
      if (funded === 0) continue;
      for (const [payCat, amt] of distributeProportionally(
        funded,
        outflowByUnitPay[unitId][month],
      )) {
        (fundedByPay[payCat] ??= {})[month] = (fundedByPay[payCat]?.[month] ?? 0) + amt;
      }
    }
  }

  const payCats = new Set<string>([
    ...Object.keys(fundedByPay),
    ...Object.keys(returnsByPay),
    ...Object.keys(paymentsByPay),
    ...Object.keys(spendingByPay),
  ]);

  // Payment-category activity = funded spending − returns − payments.
  const paymentActivity: MonthlyCents = {};
  for (const payCat of payCats) {
    const months = new Set<string>([
      ...Object.keys(fundedByPay[payCat] ?? {}),
      ...Object.keys(returnsByPay[payCat] ?? {}),
      ...Object.keys(paymentsByPay[payCat] ?? {}),
    ]);
    for (const month of months) {
      const activity =
        (fundedByPay[payCat]?.[month] ?? 0) -
        (returnsByPay[payCat]?.[month] ?? 0) -
        (paymentsByPay[payCat]?.[month] ?? 0);
      if (activity !== 0) (paymentActivity[payCat] ??= {})[month] = activity;
    }
  }

  // Viewed-month breakdown for the UI popover.
  const breakdown: Record<string, PaymentCategoryBreakdown> = {};
  for (const payCat of payCats) {
    const spending = -(spendingByPay[payCat]?.[throughMonth] ?? 0) || 0; // avoid -0
    const returns = returnsByPay[payCat]?.[throughMonth] ?? 0;
    const funded = fundedByPay[payCat]?.[throughMonth] ?? 0;
    const payments = paymentsByPay[payCat]?.[throughMonth] ?? 0;
    const paymentsAndReturns = -(payments + returns) || 0; // avoid -0
    breakdown[payCat] = {
      spendingCents: spending,
      returnsCents: returns,
      totalSpendingCents: spending + returns,
      fundedSpendingCents: funded,
      paymentsAndReturnsCents: paymentsAndReturns,
      totalActivityCents: funded + paymentsAndReturns,
    };
  }

  return { paymentActivity, breakdown };
}

/**
 * Ready to Assign — the global pool of assignable cash.
 *
 * RTA = inflows through the viewed month − credit-card opening balances − total
 * spending assignments (any month). Credit-card opening balances are
 * categorized to RTA (matching YNAB's register) but represent pre-existing
 * debt, not assignable cash; they are negative, so subtracting them backs the
 * debt out of the pool. The debt instead surfaces as an underfunded payment
 * category. See docs/budgeting-app-architecture.md.
 */
export function computeReadyToAssign(input: {
  rtaActivityCents: number;
  creditCardOpeningBalanceCents: number;
  totalSpendingAssignedCents: number;
}): number {
  return (
    input.rtaActivityCents -
    input.creditCardOpeningBalanceCents -
    input.totalSpendingAssignedCents
  );
}

/** Raw category as returned by the `category_groups → categories` join. */
export type RawCategory = {
  id: string;
  name: string;
  role: "ready_to_assign" | null;
  is_pinned: boolean;
  is_hidden: boolean;
  sort_index: number;
};

/** Raw group as returned by the `category_groups` query. */
export type RawGroup = {
  id: string;
  name: string;
  budget_mode: "category" | "group";
  is_pinned: boolean;
  sort_index: number;
  categories: RawCategory[];
};

/**
 * Assemble the per-group / per-category view model shown by the budget screen
 * (and reused by the home assign popup). Categories are sorted by the
 * user-defined sort_index; availability rolls forward through `month`.
 */
export function buildBudgetGroups(params: {
  groups: RawGroup[];
  month: string;
  catActivity: MonthlyCents;
  catAssigned: MonthlyCents;
  grpActivity: MonthlyCents;
  grpAssigned: MonthlyCents;
  catTargets: Record<string, TargetData>;
  grpTargets: Record<string, TargetData>;
  cardRegisterBalance: Map<string, number>;
  cardBreakdown: Record<string, PaymentCategoryBreakdown>;
}): BudgetGroup[] {
  const {
    groups,
    month,
    catActivity,
    catAssigned,
    grpActivity,
    grpAssigned,
    catTargets,
    grpTargets,
    cardRegisterBalance,
    cardBreakdown,
  } = params;

  return groups.map((group) => {
    const sortedCats = [...(group.categories ?? [])].sort(
      (a, b) => a.sort_index - b.sort_index,
    );

    const categories: BudgetCategory[] = sortedCats.map((c) => {
      const actHistory = catActivity[c.id] ?? {};
      const asnHistory = catAssigned[c.id] ?? {};
      // RTA available is computed globally (computeReadyToAssign), never as a
      // budget row; show 0 here so it can't render as a spendable envelope.
      const availableCents =
        c.role === "ready_to_assign"
          ? 0
          : computeAvailableThrough(month, actHistory, asnHistory);
      return {
        id: c.id,
        name: c.name,
        role: c.role ?? null,
        isPinned: c.is_pinned,
        isHidden: c.is_hidden,
        assignedCents: asnHistory[month] ?? 0,
        activityCents: actHistory[month] ?? 0,
        availableCents,
        target: catTargets[c.id] ?? null,
        cardRegisterBalanceCents: cardRegisterBalance.get(c.id) ?? null,
        cardActivityBreakdown: cardBreakdown[c.id] ?? null,
      };
    });

    return {
      id: group.id,
      name: group.name,
      budgetMode: group.budget_mode,
      isPinned: group.is_pinned,
      categories,
      groupAssignedCents: grpAssigned[group.id]?.[month] ?? 0,
      groupActivityCents: grpActivity[group.id]?.[month] ?? 0,
      groupAvailableCents: computeAvailableThrough(
        month,
        grpActivity[group.id] ?? {},
        grpAssigned[group.id] ?? {},
      ),
      target: grpTargets[group.id] ?? null,
    };
  });
}

/** Find the Ready-to-Assign category id within already-fetched group data. */
export function findReadyToAssignId(groups: RawGroup[]): string | null {
  for (const g of groups) {
    for (const c of g.categories ?? []) {
      if (c.role === "ready_to_assign") return c.id;
    }
  }
  return null;
}
