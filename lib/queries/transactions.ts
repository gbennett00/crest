"use client";

import type { QueryClient } from "@tanstack/react-query";
import { defineQuery } from "./define-query";
import type { AllTransactionsResponse } from "@/app/api/transactions/route";

export type SearchScope = "all" | "payee" | "category" | "memo";

export type TransactionsFilters = {
  q?: string;
  scope?: SearchScope;
  accountId?: string;
  categoryId?: string;
  dateFrom?: string;
  dateTo?: string;
};

async function fetchAllTransactions(
  filters: TransactionsFilters,
): Promise<AllTransactionsResponse> {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.scope && filters.scope !== "all") params.set("scope", filters.scope);
  if (filters.accountId) params.set("account", filters.accountId);
  if (filters.categoryId) params.set("category", filters.categoryId);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  const qs = params.toString();
  const res = await fetch(`/api/transactions${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to load transactions");
  return res.json();
}

const allTransactionsQuery = defineQuery("all-transactions", fetchAllTransactions);

export function useAllTransactions(filters: TransactionsFilters) {
  return allTransactionsQuery.useResource([filters]);
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
