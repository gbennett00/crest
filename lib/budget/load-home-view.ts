import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { currentBudgetMonth } from "@/lib/ledger";
import type {
  AccountOption,
  CategoryOption,
} from "@/components/transactions/transaction-form";
import type { BudgetData, BudgetViewItem } from "./types";
import { loadBudgetView } from "./load-budget-view";
import { loadCategoryOptions } from "./category-options";
import { selectOverspent, selectPinned } from "./selectors";
import { throwOnQueryErrors } from "./query-errors";
import {
  rankPayeeCategories,
  suggestionWindowStart,
  suggestionsFor,
  type PayeeHistoryRow,
} from "./approval";

// A transaction awaiting approval, shaped for the home "Needs Approval" list.
export type PendingTransaction = {
  id: string;
  payee: string;
  amountCents: number;
  txnDate: string;
  accountName: string;
  /** Category name, "Split (n)", or null when uncategorized. */
  categoryLabel: string | null;
  /** The category was filled in automatically (rule or payee history). */
  suggested: boolean;
  /** The single category it carries; null when uncategorized or split. */
  categoryId: string | null;
  /**
   * Quick picks for the approve drawer, best first: its current category,
   * then the payee's most used categories over the last 90 days (max 4).
   */
  suggestedCategoryIds: string[];
};

// Everything the home screen renders. Built from the shared budget view plus a
// few home-only lookups (pending transactions, account/category pickers).
export type HomeData = {
  budgetData: BudgetData;
  overspent: BudgetViewItem[];
  pinned: BudgetViewItem[];
  pending: PendingTransaction[];
  accounts: AccountOption[];
  categories: CategoryOption[];
};

/** Page-facing entry point: builds the entire home view. */
export async function getHomeData(): Promise<HomeData> {
  return loadHomeData(await createClient());
}

export async function loadHomeData(client: SupabaseClient): Promise<HomeData> {
  const month = currentBudgetMonth();

  const [budgetData, pendingRes, accountsRes, categories] = await Promise.all([
    loadBudgetView(client, month),
    client
      .from("transactions")
      .select(
        "id, payee, payee_key, amount_cents, txn_date, account_id, category_source, accounts!account_id(name), transaction_allocations(category_id, categories(name))",
      )
      .is("approved_at", null)
      .order("txn_date", { ascending: false })
      .limit(25),
    client
      .from("accounts")
      .select("id, name, on_budget")
      .eq("is_active", true)
      .order("name"),
    loadCategoryOptions(client),
  ]);
  throwOnQueryErrors({ "pending transactions": pendingRes, accounts: accountsRes });

  type RawPending = {
    id: string;
    payee: string | null;
    payee_key: string | null;
    amount_cents: number;
    txn_date: string;
    category_source: string | null;
    accounts: { name: string } | null;
    transaction_allocations:
      | { category_id: string; categories: { name: string } | null }[]
      | null;
  };
  const rawPending = (pendingRes.data ?? []) as unknown as RawPending[];

  const ranked = await loadPayeeRankings(
    client,
    rawPending.map((t) => t.payee_key),
    new Set(categories.map((c) => c.id)),
  );

  const pending: PendingTransaction[] = rawPending.map((t) => {
    const allocs = t.transaction_allocations ?? [];
    const categoryId = allocs.length === 1 ? allocs[0].category_id : null;
    return {
      id: t.id,
      payee: t.payee || "—",
      amountCents: t.amount_cents,
      txnDate: t.txn_date,
      accountName: t.accounts?.name ?? "Unknown",
      categoryLabel:
        allocs.length === 0
          ? null
          : allocs.length === 1
            ? (allocs[0].categories?.name ?? "Unknown")
            : `Split (${allocs.length})`,
      suggested: t.category_source !== null && allocs.length > 0,
      categoryId,
      suggestedCategoryIds: suggestionsFor(
        categoryId,
        t.payee_key ? ranked.get(t.payee_key) : undefined,
      ),
    };
  });

  const accounts: AccountOption[] = (
    (accountsRes.data ?? []) as { id: string; name: string; on_budget: boolean }[]
  ).map((a) => ({ id: a.id, name: a.name, onBudget: a.on_budget }));

  return {
    budgetData,
    overspent: selectOverspent(budgetData),
    pinned: selectPinned(budgetData),
    pending,
    accounts,
    categories,
  };
}

/**
 * Each pending payee's categories from its approved, non-transfer history in
 * the suggestion window, most used first. One query for every payee shown.
 */
async function loadPayeeRankings(
  client: SupabaseClient,
  payeeKeys: (string | null)[],
  validCategoryIds: ReadonlySet<string>,
): Promise<Map<string, string[]>> {
  const keys = [...new Set(payeeKeys.filter((k): k is string => !!k))];
  if (keys.length === 0) return new Map();

  const res = await client
    .from("transactions")
    .select("payee_key, txn_date, transaction_allocations(category_id)")
    .in("payee_key", keys)
    .not("approved_at", "is", null)
    .is("transfer_account_id", null)
    .gte("txn_date", suggestionWindowStart(new Date()))
    .order("txn_date", { ascending: false })
    .limit(2000);
  throwOnQueryErrors({ "payee history": res });

  const history: PayeeHistoryRow[] = (
    (res.data ?? []) as unknown as {
      payee_key: string;
      txn_date: string;
      transaction_allocations: { category_id: string }[] | null;
    }[]
  ).map((r) => ({
    payeeKey: r.payee_key,
    txnDate: r.txn_date,
    categoryIds: (r.transaction_allocations ?? []).map((a) => a.category_id),
  }));
  return rankPayeeCategories(history, validCategoryIds);
}
