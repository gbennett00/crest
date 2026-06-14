import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ChevronLeft } from "lucide-react";
import { EditTransactionForm } from "@/components/transactions/edit-transaction-form";
import type { CategoryOption } from "@/components/transactions/edit-transaction-form";

export default function EditTransactionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  return (
    <Suspense fallback={<div className="pt-12 animate-pulse p-4 space-y-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 bg-muted rounded" />)}</div>}>
      <EditTransactionContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EditTransactionContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  const { back } = await searchParams;
  const backHref = back ?? "/accounts";

  const supabase = await createClient();

  const [txnRes, accountsRes, categoriesRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, payee, amount_cents, txn_date, memo, cleared_at, approved_at, account_id, transaction_allocations(category_id, amount_cents, categories(name))")
      .eq("id", id)
      .single(),
    supabase.from("accounts").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("categories")
      .select("id, name, role, is_hidden, category_groups!group_id(name)")
      .eq("is_hidden", false)
      .order("name"),
  ]);

  if (txnRes.error || !txnRes.data) {
    return (
      <div className="p-4">
        <p className="text-destructive text-sm">Transaction not found.</p>
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = txnRes.data as any;
  const allocs: { category_id: string; amount_cents: number }[] = raw.transaction_allocations ?? [];
  const allocations = allocs.map((a) => ({
    categoryId: a.category_id,
    amountCents: a.amount_cents,
  }));
  const primaryAlloc = allocs[0] ?? null;

  const txn = {
    id: raw.id as string,
    payee: (raw.payee as string) || "",
    txnDate: raw.txn_date as string,
    accountId: raw.account_id as string,
    amountCents: raw.amount_cents as number,
    memo: raw.memo as string | null,
    clearedAt: raw.cleared_at as string | null,
    isApproved: !!raw.approved_at,
    categoryId: primaryAlloc?.category_id ?? null,
    allocations,
  };

  const accounts = (accountsRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
  }));

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

  return (
    <div className="max-w-lg pt-12">
      <div className="sticky top-12 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Link href={backHref} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft size={20} />
        </Link>
        <h1 className="font-semibold text-sm">Edit Transaction</h1>
      </div>

      <EditTransactionForm
        txn={txn}
        accounts={accounts}
        categories={categories}
        backHref={backHref}
      />
    </div>
  );
}
