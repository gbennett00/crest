import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadAccountBalance, loadAccountClosureState } from "@/lib/ledger";
import type { RegisterTxn } from "@/components/accounts/register-transaction-list";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-form";

export type AccountRegisterResponse = {
  found: boolean;
  account: {
    id: string;
    name: string;
    isLinked: boolean;
    bankBalanceCents: number | null;
    isActive: boolean;
  } | null;
  registerClearedBalanceCents: number;
  unclearedCents: number;
  workingCents: number;
  closeBlockReason: string | undefined;
  canClose: boolean;
  categoryName: string | null;
  txns: RegisterTxn[];
  accountOptions: AccountOption[];
  categoryOptions: CategoryOption[];
};

// Same query the account register page's Server Component ran, exposed as
// JSON for the client-side query cache (lib/queries/accounts.ts).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const categoryFilter = request.nextUrl.searchParams.get("category") ?? undefined;
  const monthFilter = request.nextUrl.searchParams.get("month") ?? undefined;
  const supabase = await createClient();

  const [accountRes, txnsRes, balance, categoriesRes, accountsRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, type, is_linked, balance_cents, is_active")
      .eq("id", id)
      .single(),
    supabase
      .from("transactions")
      .select(
        "id, payee, amount_cents, txn_date, approved_at, cleared_at, reconciled_at, memo, transaction_allocations(category_id, amount_cents, categories(name))",
      )
      .eq("account_id", id)
      .order("txn_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    // Balance summaries aggregated in Postgres (see account_balances view) —
    // avoids fetching every row and the PostgREST max_rows truncation bug.
    loadAccountBalance(supabase, id),
    supabase
      .from("categories")
      .select("id, name, role, category_groups!group_id(name)")
      .eq("is_hidden", false)
      .order("name"),
    // Active accounts power the Add-Transaction form's account picker.
    supabase.from("accounts").select("id, name, on_budget").eq("is_active", true).order("name"),
  ]);

  if (accountRes.error || !accountRes.data) {
    return NextResponse.json({ found: false, account: null } as Partial<AccountRegisterResponse>);
  }

  const account = accountRes.data;
  const closure = await loadAccountClosureState(supabase, id);
  const closeBlockReason = !closure.allCleared
    ? "All transactions must be cleared"
    : closure.workingBalanceCents !== 0
      ? "Working balance must be zero"
      : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txns = (txnsRes.data ?? []) as any[];

  if (categoryFilter) {
    txns = txns.filter((t) =>
      t.transaction_allocations?.some(
        (a: { category_id: string }) => a.category_id === categoryFilter,
      ),
    );
  }

  if (monthFilter) {
    const monthStart = monthFilter;
    const [y, m] = monthStart.split("-").map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    txns = txns.filter((t) => t.txn_date >= monthStart && t.txn_date < nextMonth);
  }

  const categoryName = categoryFilter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (categoriesRes.data ?? []).find((c: any) => c.id === categoryFilter)?.name ?? "Category"
    : null;

  const registerTxns: RegisterTxn[] = txns.map((txn) => {
    const allocs: { category_id: string; amount_cents: number; categories: { name: string } | null }[] =
      txn.transaction_allocations ?? [];
    const categoryLabel =
      allocs.length === 0
        ? "Uncategorized"
        : allocs.length === 1
          ? allocs[0].categories?.name ?? "Unknown"
          : `Split (${allocs.length})`;
    return {
      id: txn.id as string,
      payee: (txn.payee as string) ?? null,
      amountCents: txn.amount_cents as number,
      txnDate: txn.txn_date as string,
      approved: !!txn.approved_at,
      cleared: !!txn.cleared_at,
      reconciled: !!txn.reconciled_at,
      memo: (txn.memo as string) ?? null,
      categoryLabel,
    };
  });

  const accountOptions: AccountOption[] = (
    (accountsRes.data ?? []) as { id: string; name: string; on_budget: boolean }[]
  ).map((a) => ({ id: a.id, name: a.name, onBudget: a.on_budget }));
  const categoryOptions: CategoryOption[] = (
    (categoriesRes.data ?? []) as unknown as Array<{
      id: string;
      name: string;
      role: string | null;
      category_groups: { name: string } | null;
    }>
  ).map((c) => ({
    id: c.id,
    name: c.role === "ready_to_assign" ? "Ready to Assign" : c.name,
    groupName: c.role === "ready_to_assign" ? "— Inflows —" : c.category_groups?.name ?? "Other",
  }));

  const response: AccountRegisterResponse = {
    found: true,
    account: {
      id: account.id as string,
      name: account.name as string,
      isLinked: account.is_linked as boolean,
      bankBalanceCents: account.balance_cents as number | null,
      isActive: account.is_active as boolean,
    },
    registerClearedBalanceCents: balance.clearedCents,
    unclearedCents: balance.unclearedCents,
    workingCents: balance.workingCents,
    closeBlockReason,
    canClose: closure.eligible,
    categoryName,
    txns: registerTxns,
    accountOptions,
    categoryOptions,
  };

  return NextResponse.json(response);
}
