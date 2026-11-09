"use client";

import { useTransition } from "react";
import { keepPreviousData, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { defineQuery, invalidateAllLedgerQueries, LEDGER_ROOT } from "./define-query";
import { setTargetSnoozed } from "@/app/(app)/budget/actions";
import { withTargetSnoozed } from "@/lib/budget/snooze";
import { withAssignments, type AssignTarget } from "@/lib/budget/assign-patch";
import { selectOverspent, selectPinned } from "@/lib/budget/selectors";
import type { BudgetData } from "@/lib/budget/types";
import type { HomeData } from "@/lib/budget/load-home-view";
import { homeViewQueryName } from "./home";
import { createActionQueue } from "./in-order";
import { runOptimistic, type LedgerPatch } from "./optimistic";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-form";

export type BudgetViewResponse = {
  data: BudgetData;
  accounts: AccountOption[];
  categories: CategoryOption[];
};

async function fetchBudgetView(month: string): Promise<BudgetViewResponse> {
  const res = await fetch(`/api/budget-view?month=${month}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to load budget");
  }
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

/**
 * Snoozes (or, with a null month, unsnoozes) a category's/group's target.
 * The cached budget view of every month is patched immediately so the pill
 * flips at once; the server write follows, and the cache is restored if it
 * fails, then refetched either way to pick up the server's numbers.
 */
export function useSnoozeTarget() {
  const queryClient = useQueryClient();
  const [, startTransition] = useTransition();

  return (entityType: "category" | "group", id: string, month: string | null) => {
    const filters = { queryKey: [...LEDGER_ROOT, budgetViewQuery.name] };
    // Stop an in-flight refetch from landing over the optimistic value.
    void queryClient.cancelQueries(filters);
    const previous = queryClient.getQueriesData<BudgetViewResponse>(filters);
    queryClient.setQueriesData<BudgetViewResponse>(filters, (old) =>
      old && { ...old, data: withTargetSnoozed(old.data, entityType, id, month) },
    );

    startTransition(async () => {
      const result = await setTargetSnoozed(id, entityType, month);
      if ("error" in result) {
        for (const [key, data] of previous) queryClient.setQueryData(key, data);
      }
      invalidateAllLedgerQueries(queryClient);
    });
  };
}

/**
 * A patch for runOptimistic that shows `targets` assigned for `month`, in
 * that month's cached budget view and in Home (whose overspent and pinned
 * lists are derived from its budget data).
 */
export function assignmentPatch(month: string, targets: AssignTarget[]): LedgerPatch {
  return (key, data) => {
    if (data === undefined || data === null) return data;
    if (key[1] === budgetViewQuery.name && key[2] === month) {
      const res = data as BudgetViewResponse;
      const patched = withAssignments(res.data, month, targets);
      return patched === res.data ? data : { ...res, data: patched };
    }
    if (key[1] === homeViewQueryName) {
      const home = data as HomeData;
      const budgetData = withAssignments(home.budgetData, month, targets);
      if (budgetData === home.budgetData) return data;
      return {
        ...home,
        budgetData,
        overspent: selectOverspent(budgetData),
        pinned: selectPinned(budgetData),
      };
    }
    return data;
  };
}

// Assignment writes reach the server one at a time, in the order they were made.
const inOrder = createActionQueue();

/**
 * Shows an assignment write (absolute `targets` for `month`) at once and runs
 * `action` behind it; on failure it's rolled back with a banner titled
 * `title`. `action` may throw, or return `{ error }` / `{ success }`.
 */
export function runAssignment(
  queryClient: QueryClient,
  {
    month,
    targets,
    action,
    title,
  }: {
    month: string;
    targets: AssignTarget[];
    action: () => Promise<{ error?: string; success?: boolean } | void>;
    title: string;
  },
) {
  runOptimistic(queryClient, {
    patch: assignmentPatch(month, targets),
    action: inOrder(action),
    errorOf: (result) => {
      const r = result as { error?: string; success?: boolean } | undefined;
      if (r?.error) return r.error;
      if (r?.success === false) return "The server didn’t save it.";
      return null;
    },
    failure: { title },
  });
}
