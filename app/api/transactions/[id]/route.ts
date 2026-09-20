import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { CategoryOption, TransactionEditData } from "@/components/transactions/transaction-form";

// Same query the transaction edit page's Server Component ran, exposed as
// JSON so the client-side query cache (lib/queries/transaction-detail.ts) can
// fetch a transaction on-demand — for cache misses and the prefetch fired
// when a register row is hovered/tapped — instead of a full RSC round-trip.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const [txnRes, accountsRes, categoriesRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, payee, amount_cents, txn_date, memo, cleared_at, reconciled_at, approved_at, account_id, transfer_account_id, transaction_allocations(category_id, amount_cents, categories(name))")
      .eq("id", id)
      .single(),
    // All accounts (including closed) — active ones feed the pickers, while the
    // full set resolves counterpart names on transfers to closed accounts.
    supabase.from("accounts").select("id, name, is_active, on_budget").order("name"),
    supabase
      .from("categories")
      .select("id, name, role, is_hidden, category_groups!group_id(name)")
      .eq("is_hidden", false)
      .order("name"),
  ]);

  if (txnRes.error || !txnRes.data) {
    return NextResponse.json({ txn: null, accounts: [], accountNameById: {}, categories: [] });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = txnRes.data as any;
  const allocs: { category_id: string; amount_cents: number }[] = raw.transaction_allocations ?? [];
  const allocations = allocs.map((a) => ({
    categoryId: a.category_id,
    amountCents: a.amount_cents,
  }));
  const primaryAlloc = allocs[0] ?? null;

  const txn: TransactionEditData = {
    id: raw.id as string,
    payee: (raw.payee as string) || "",
    txnDate: raw.txn_date as string,
    accountId: raw.account_id as string,
    amountCents: raw.amount_cents as number,
    memo: raw.memo as string | null,
    clearedAt: raw.cleared_at as string | null,
    reconciledAt: raw.reconciled_at as string | null,
    transferAccountId: raw.transfer_account_id as string | null,
    isApproved: !!raw.approved_at,
    categoryId: primaryAlloc?.category_id ?? null,
    allocations,
  };

  const allAccounts = (accountsRes.data ?? []) as {
    id: string;
    name: string;
    is_active: boolean;
    on_budget: boolean;
  }[];
  // Only active accounts can be chosen in the pickers…
  const accounts = allAccounts
    .filter((a) => a.is_active)
    .map((a) => ({ id: a.id, name: a.name, onBudget: a.on_budget }));
  // …but every account name is available for read-only display (e.g. the
  // counterpart of a transfer whose other account has since been closed).
  const accountNameById = Object.fromEntries(
    allAccounts.map((a) => [a.id, a.name]),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories: CategoryOption[] = (categoriesRes.data ?? []).map((c: any) => ({
    id: c.id as string,
    name: (c.role === "ready_to_assign" ? "Ready to Assign" : c.name) as string,
    groupName: c.role === "ready_to_assign"
      ? "— Inflows —"
      : (((c.category_groups as { name: string } | null)?.name) ?? "Other"),
  })).sort((a: CategoryOption, b: CategoryOption) => {
    if (a.groupName === "— Inflows —") return -1;
    if (b.groupName === "— Inflows —") return 1;
    return 0;
  });

  return NextResponse.json({ txn, accounts, accountNameById, categories });
}
