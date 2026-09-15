"use client";

import { keepPreviousData, type QueryClient } from "@tanstack/react-query";
import { defineQuery } from "./define-query";
import type { BudgetData } from "@/lib/budget/types";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-form";

export type BudgetViewResponse = {
  data: BudgetData;
  accounts: AccountOption[];
  categories: CategoryOption[];
};

async function fetchBudgetView(month: string): Promise<BudgetViewResponse> {
  const res = await fetch(`/api/budget-view?month=${month}`);
  if (!res.ok) throw new Error("Failed to load budget");
  return res.json();
}

const budgetViewQuery = defineQuery("budget-view", fetchBudgetView);

export const budgetViewKey = (month: string) => budgetViewQuery.key(month);

export function useBudgetView(month: string, initialData?: BudgetViewResponse) {
  return budgetViewQuery.useResource([month], {
    initialData,
    // Show the previous month's numbers while a jump to an uncached month
    // (e.g. via the month picker, or one 6 months back) is in flight, instead
    // of blanking to a skeleton — most of the screen is still correct, and
    // the real data swaps in as soon as it lands.
    placeholderData: keepPreviousData,
  });
}

/** Warms the cache for a month that isn't on screen yet. */
export function prefetchBudgetView(queryClient: QueryClient, month: string) {
  return budgetViewQuery.prefetch(queryClient, month);
}

/** Re-fetches one month's budget view after a mutation touches it. Omit
 * `month` to invalidate every cached month (rare, cross-month mutations like
 * renaming a category or reordering groups). */
export function invalidateBudgetView(queryClient: QueryClient, month?: string) {
  return month
    ? budgetViewQuery.invalidate(queryClient, month)
    : budgetViewQuery.invalidate(queryClient);
}
