"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { BudgetData } from "@/lib/budget/types";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-form";

export type BudgetViewResponse = {
  data: BudgetData;
  accounts: AccountOption[];
  categories: CategoryOption[];
};

export function budgetViewKey(month: string) {
  return ["budget-view", month] as const;
}

async function fetchBudgetView(month: string): Promise<BudgetViewResponse> {
  const res = await fetch(`/api/budget-view?month=${month}`);
  if (!res.ok) throw new Error("Failed to load budget");
  return res.json();
}

export function useBudgetView(month: string, initialData?: BudgetViewResponse) {
  return useQuery({
    queryKey: budgetViewKey(month),
    queryFn: () => fetchBudgetView(month),
    initialData,
  });
}

/** Warms the cache for a month that isn't on screen yet (neighbouring months). */
export function prefetchBudgetView(queryClient: QueryClient, month: string) {
  return queryClient.prefetchQuery({
    queryKey: budgetViewKey(month),
    queryFn: () => fetchBudgetView(month),
  });
}

/** Re-fetches one month's budget view after a mutation touches it. */
export function invalidateBudgetView(queryClient: QueryClient, month: string) {
  return queryClient.invalidateQueries({ queryKey: budgetViewKey(month) });
}
