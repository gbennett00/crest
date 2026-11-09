import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { AllTransactionsResponse, AllTransactionsRow } from "@/app/api/transactions/route";
import { categoryListFromMonth, monthToDateRange } from "./transactions";

const range = monthToDateRange("2026-11-01");

function row(id: string, categoryIds: string[]): AllTransactionsRow {
  return {
    id,
    payee: id,
    amountCents: -1_000,
    txnDate: "2026-11-05",
    approved: true,
    cleared: true,
    reconciled: false,
    memo: null,
    categoryLabel: "x",
    suggested: false,
    needsCategory: false,
    categoryIds,
    accountId: "checking",
    accountName: "Checking",
  };
}

function withMonth(txns: AllTransactionsRow[], hasMore = false) {
  const qc = new QueryClient();
  const month: AllTransactionsResponse = { txns, hasMore, accountOptions: [], categoryOptions: [] };
  qc.setQueryData(["ledger", "all-transactions", range], month);
  return qc;
}

describe("categoryListFromMonth", () => {
  it("keeps the month's rows allocated to the category, splits included", () => {
    const qc = withMonth([row("a", ["food"]), row("b", ["rent"]), row("c", ["rent", "food"])]);
    expect(categoryListFromMonth(qc, "food", range)?.txns.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("gives nothing when the month list was truncated", () => {
    const qc = withMonth([row("a", ["food"])], true);
    expect(categoryListFromMonth(qc, "food", range)).toBeUndefined();
  });

  it("gives nothing when the month isn't cached", () => {
    expect(categoryListFromMonth(new QueryClient(), "food", range)).toBeUndefined();
  });

  it("falls back to the complete recent list, keeping only that month", () => {
    const qc = new QueryClient();
    const recent: AllTransactionsResponse = {
      txns: [row("a", ["food"]), { ...row("old", ["food"]), txnDate: "2026-10-30" }],
      hasMore: false,
      accountOptions: [],
      categoryOptions: [],
    };
    qc.setQueryData(["ledger", "all-transactions", {}], recent);
    expect(categoryListFromMonth(qc, "food", range)?.txns.map((t) => t.id)).toEqual(["a"]);
  });
});
