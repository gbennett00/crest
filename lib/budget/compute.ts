// Pure budget calculations — no Supabase, no React, no IO.
//
// `load-budget-view.ts` fetches rows and feeds them through these functions.
// Keeping the math here (and DB-free) makes it the single source of truth for
// both the budget and home screens, and lets it be unit-tested with plain
// integer-cents fixtures.

import { computeAvailableThrough, OPENING_BALANCE_IMPORTED_ID } from "@/lib/ledger";
import type { BudgetCategory, BudgetGroup, TargetData } from "./types";

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

/** A credit-card transaction, normalized for payment-category activity rollup. */
export type CreditCardTxn = {
  accountId: string;
  amountCents: number;
  txnDate: string;
  importedId: string | null;
  isTransfer: boolean;
  hasAllocations: boolean;
};

/**
 * Inject credit-card funded spending into payment-category activity (mutates
 * `catActivity` in place).
 *
 * Purchases on the card (approved, categorized, non-transfer) fill the payment
 * category automatically; payments to the card (transfer inflows) drain it.
 * Opening-balance transactions are excluded — pre-existing debt must be funded
 * manually by assigning to the payment category.
 */
export function injectCreditCardActivity(
  catActivity: MonthlyCents,
  txns: CreditCardTxn[],
  accountToPaymentCategory: Map<string, string>,
): void {
  for (const txn of txns) {
    const paymentCatId = accountToPaymentCategory.get(txn.accountId);
    if (!paymentCatId) continue;
    if (txn.importedId === OPENING_BALANCE_IMPORTED_ID) continue;

    const monthKey = txn.txnDate.slice(0, 7) + "-01";
    let contribution = 0;
    if (txn.amountCents < 0 && !txn.isTransfer && txn.hasAllocations) {
      contribution = Math.abs(txn.amountCents);
    } else if (txn.amountCents > 0 && txn.isTransfer) {
      contribution = -txn.amountCents;
    }

    if (contribution !== 0) {
      (catActivity[paymentCatId] ??= {})[monthKey] =
        (catActivity[paymentCatId]?.[monthKey] ?? 0) + contribution;
    }
  }
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
};

/** Raw group as returned by the `category_groups` query. */
export type RawGroup = {
  id: string;
  name: string;
  budget_mode: "category" | "group";
  is_pinned: boolean;
  categories: RawCategory[];
};

/**
 * Assemble the per-group / per-category view model shown by the budget screen
 * (and reused by the home assign popup). Categories are sorted pinned-first
 * then alphabetically; availability rolls forward through `month`.
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
  } = params;

  return groups.map((group) => {
    const sortedCats = [...(group.categories ?? [])].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) return Number(b.is_pinned) - Number(a.is_pinned);
      return a.name.localeCompare(b.name);
    });

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
