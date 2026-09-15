"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";

export type CategoryTransactionRow = {
  id: string;
  payee: string | null;
  amount_cents: number;
  txn_date: string;
  approved_at: string | null;
  cleared_at: string | null;
  memo: string | null;
  accounts: { name: string } | { name: string }[] | null;
  transaction_allocations: { amount_cents: number; category_id: string }[];
};

export type TransactionsByCategoryResponse = {
  categoryName: string;
  txns: CategoryTransactionRow[];
};

export function transactionsByCategoryKey(categoryId: string, month: string | undefined) {
  return ["transactions-by-category", categoryId, month ?? ""] as const;
}

async function fetchTransactionsByCategory(
  categoryId: string,
  month: string | undefined,
): Promise<TransactionsByCategoryResponse> {
  const params = new URLSearchParams({ category: categoryId });
  if (month) params.set("month", month);
  const res = await fetch(`/api/transactions-by-category?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load transactions");
  return res.json();
}

export function useTransactionsByCategory(categoryId: string, month: string | undefined) {
  return useQuery({
    queryKey: transactionsByCategoryKey(categoryId, month),
    queryFn: () => fetchTransactionsByCategory(categoryId, month),
    enabled: !!categoryId,
  });
}

/** Warms the cache for a category register before the user clicks into it. */
export function prefetchTransactionsByCategory(
  queryClient: QueryClient,
  categoryId: string,
  month: string | undefined,
) {
  return queryClient.prefetchQuery({
    queryKey: transactionsByCategoryKey(categoryId, month),
    queryFn: () => fetchTransactionsByCategory(categoryId, month),
  });
}
