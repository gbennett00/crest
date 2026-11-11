"use client";

import type { QueryClient, UseQueryOptions } from "@tanstack/react-query";
import { defineQuery } from "./define-query";
import { preloadWhenIdle } from "./preload";
import { preloadTransactionDetails } from "./transaction-detail";
import type { AllTransactionsResponse } from "@/app/api/transactions/route";

export type TransactionsFilters = {
  q?: string;
  accountId?: string;
  categoryId?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: string;
  amountMax?: string;
};

async function fetchAllTransactions(
  filters: TransactionsFilters,
): Promise<AllTransactionsResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.accountId) params.set("account", filters.accountId);
  if (filters.categoryId) params.set("category", filters.categoryId);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.amountMin) params.set("amountMin", filters.amountMin);
  if (filters.amountMax) params.set("amountMax", filters.amountMax);
  const qs = params.toString();
  const res = await fetch(`/api/transactions${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to load transactions");
  return res.json();
}

const allTransactionsQuery = defineQuery("all-transactions", fetchAllTransactions);

export function useAllTransactions(
  filters: TransactionsFilters,
  options?: Omit<UseQueryOptions<AllTransactionsResponse>, "queryKey" | "queryFn">,
) {
  return allTransactionsQuery.useResource([filters], options);
}

/**
 * One category's transactions for a month, drawn from a wider cached list, to
 * show while the category's own query loads: the whole month's list, or else
 * the unfiltered recent list. Only from a list that isn't truncated: the
 * server filters a category within the same row window, so the two then
 * match exactly.
 */
export function categoryListFromMonth(
  queryClient: QueryClient,
  categoryId: string,
  range: { dateFrom: string; dateTo: string },
): AllTransactionsResponse | undefined {
  const complete = (filters: TransactionsFilters) => {
    const list = queryClient.getQueryData<AllTransactionsResponse>(allTransactionsQuery.key(filters));
    return list && !list.hasMore ? list : undefined;
  };
  const source =
    complete({ dateFrom: range.dateFrom, dateTo: range.dateTo }) ?? complete({});
  if (!source) return undefined;
  return {
    ...source,
    txns: source.txns.filter(
      (t) =>
        t.txnDate >= range.dateFrom &&
        t.txnDate <= range.dateTo &&
        t.categoryIds?.includes(categoryId),
    ),
  };
}

/**
 * Queues a month's full transaction list for the idle preloader (see
 * categoryListFromMonth). `first` for the month on screen; a newer month
 * replaces one still waiting.
 */
export function preloadMonthTransactions(queryClient: QueryClient, month: string, first = false) {
  preloadWhenIdle([() => prefetchAllTransactions(queryClient, monthToDateRange(month))], {
    group: "month-transactions",
    first,
  });
}

/** Queues the edit pages of the Activity tab's first rows for the idle preloader. */
export function preloadRecentTransactionDetails(queryClient: QueryClient) {
  preloadWhenIdle(
    [
      async () => {
        await prefetchAllTransactions(queryClient, {});
        const recent = queryClient.getQueryData<AllTransactionsResponse>(allTransactionsQuery.key({}));
        preloadTransactionDetails(queryClient, (recent?.txns ?? []).map((t) => t.id), {
          group: "recent-details",
        });
      },
    ],
    { group: "recent-list" },
  );
}

/** Warms the cache for the all-transactions view before the user clicks into it. */
export function prefetchAllTransactions(
  queryClient: QueryClient,
  filters: TransactionsFilters,
) {
  return allTransactionsQuery.prefetch(queryClient, filters);
}

/**
 * First/last calendar day of a budget month, as `dateFrom`/`dateTo` filter
 * values. Accepts either a bare `YYYY-MM` or the `YYYY-MM-01` DATE string
 * budget months are stored/passed as (see `currentBudgetMonth`).
 */
export function monthToDateRange(month: string): { dateFrom: string; dateTo: string } {
  const ym = month.slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { dateFrom: `${ym}-01`, dateTo: `${ym}-${String(lastDay).padStart(2, "0")}` };
}
