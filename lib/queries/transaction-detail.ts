"use client";

import type { QueryClient } from "@tanstack/react-query";
import { defineQuery } from "./define-query";
import type {
  AccountOption,
  CategoryOption,
  TransactionEditData,
} from "@/components/transactions/transaction-form";

export type TransactionDetailResponse = {
  txn: TransactionEditData | null;
  accounts: AccountOption[];
  accountNameById: Record<string, string>;
  categories: CategoryOption[];
};

async function fetchTransactionDetail(id: string): Promise<TransactionDetailResponse> {
  const res = await fetch(`/api/transactions/${id}`);
  if (!res.ok) throw new Error("Failed to load transaction");
  return res.json();
}

const transactionDetailQuery = defineQuery("transaction-detail", fetchTransactionDetail);

export function useTransactionDetail(id: string) {
  return transactionDetailQuery.useResource([id]);
}

/** Warms the cache for a transaction before the user clicks/taps into it. */
export function prefetchTransactionDetail(queryClient: QueryClient, id: string) {
  return transactionDetailQuery.prefetch(queryClient, id);
}
