"use client";

import { defineQuery } from "./define-query";
import type { BudgetMovesResponse } from "@/app/api/budget-moves/route";

export type BudgetMovesArgs = {
  unit: { type: "category" | "group"; id: string };
  /** Budget month (YYYY-MM-01); omit for all months. */
  month?: string | null;
};

async function fetchBudgetMoves({ unit, month }: BudgetMovesArgs): Promise<BudgetMovesResponse> {
  const params = new URLSearchParams({ [unit.type]: unit.id });
  if (month) params.set("month", month);
  const res = await fetch(`/api/budget-moves?${params}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Failed to load moves");
  }
  return res.json();
}

// Under the ledger root, so every budget mutation (invalidateAllLedgerQueries)
// refreshes it too.
const budgetMovesQuery = defineQuery("budget-moves", fetchBudgetMoves);

export function useBudgetMoves(args: BudgetMovesArgs, enabled = true) {
  return budgetMovesQuery.useResource([args], { enabled });
}
