import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { currentBudgetMonth } from "@/lib/ledger";
import type { CategoryOption } from "@/components/home/approve-form";
import type { AccountOption } from "@/components/transactions/transaction-form";
import type { BudgetData, BudgetViewItem } from "./types";
import { loadBudgetView } from "./load-budget-view";
import { loadCategoryOptions } from "./category-options";
import { selectOverspent, selectPinned } from "./selectors";

// A transaction awaiting approval, shaped for the home "Needs Approval" list.
export type PendingTransaction = {
  id: string;
  payee: string;
  amountCents: number;
  txnDate: string;
  accountName: string;
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
      .select("id, payee, amount_cents, txn_date, account_id, accounts!account_id(name)")
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

  const pending: PendingTransaction[] = (
    (pendingRes.data ?? []) as unknown as Array<{
      id: string;
      payee: string | null;
      amount_cents: number;
      txn_date: string;
      accounts: { name: string } | null;
    }>
  ).map((t) => ({
    id: t.id,
    payee: t.payee || "—",
    amountCents: t.amount_cents,
    txnDate: t.txn_date,
    accountName: t.accounts?.name ?? "Unknown",
  }));

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
