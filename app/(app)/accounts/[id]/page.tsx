import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  evaluateAccountClosure,
  sumClearedTransactionAmounts,
  sumPendingTransactionAmounts,
  workingBalanceCents,
} from "@/lib/ledger";
import { AccountDetailHeader } from "@/components/accounts/account-detail-header";
import { AccountBalanceSummary } from "@/components/accounts/account-balance-summary";
import { AccountAddTransaction } from "@/components/accounts/account-add-transaction";
import {
  RegisterTransactionList,
  type RegisterTxn,
} from "@/components/accounts/register-transaction-list";

export default function AccountRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ category?: string; month?: string }>;
}) {
  return (
    <Suspense fallback={<RegisterSkeleton />}>
      <RegisterContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function RegisterContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ category?: string; month?: string }>;
}) {
  const { id } = await params;
  const { category: categoryFilter, month: monthFilter } = await searchParams;
  const supabase = await createClient();

  const [accountRes, txnsRes, allTxnAmountsRes, categoriesRes, accountsRes] =
    await Promise.all([
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
      // Fetch all transaction amounts for balance calculations
      supabase
        .from("transactions")
        .select("amount_cents, cleared_at")
        .eq("account_id", id),
      supabase
        .from("categories")
        .select("id, name, role, category_groups!group_id(name)")
        .eq("is_hidden", false)
        .order("name"),
      // Active accounts power the Add-Transaction form's account picker.
      supabase
        .from("accounts")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
    ]);

  if (accountRes.error || !accountRes.data) {
    return (
      <div className="p-4">
        <p className="text-destructive text-sm">Account not found.</p>
      </div>
    );
  }

  const account = accountRes.data;

  // Compute balance summaries
  const allLines = (allTxnAmountsRes.data ?? []).map((r) => ({
    amountCents: r.amount_cents as number,
    clearedAt: r.cleared_at as string | null,
  }));
  const registerClearedBalanceCents = sumClearedTransactionAmounts(allLines);
  const unclearedCents = sumPendingTransactionAmounts(allLines);
  const workingCents = workingBalanceCents(allLines);

  // Eligibility for closing the account: all cleared + zero working balance.
  const closure = evaluateAccountClosure(allLines);
  const closeBlockReason = !closure.allCleared
    ? "All transactions must be cleared"
    : closure.workingBalanceCents !== 0
      ? "Working balance must be zero"
      : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txns = (txnsRes.data ?? []) as any[];

  // Filter by category if requested
  if (categoryFilter) {
    txns = txns.filter((t) =>
      t.transaction_allocations?.some(
        (a: { category_id: string }) => a.category_id === categoryFilter,
      ),
    );
  }

  // Filter by month if requested
  if (monthFilter) {
    const monthStart = monthFilter;
    const [y, m] = monthStart.split("-").map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    txns = txns.filter((t) => t.txn_date >= monthStart && t.txn_date < nextMonth);
  }

  const categoryName =
    categoryFilter
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (categoriesRes.data ?? []).find((c: any) => c.id === categoryFilter)?.name ?? "Category"
      : null;

  // Shape the register rows for the client list (selection + bulk editing).
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

  const subtitle = monthFilter
    ? `${MONTH_NAMES[+monthFilter.slice(5, 7) - 1]} ${monthFilter.slice(0, 4)}`
    : "All transactions";

  // Options for the floating Add-Transaction form.
  const accountOptions = ((accountsRes.data ?? []) as { id: string; name: string }[]).map(
    (a) => ({ id: a.id, name: a.name }),
  );
  const categoryOptions = (
    (categoriesRes.data ?? []) as unknown as Array<{
      id: string;
      name: string;
      role: string | null;
      category_groups: { name: string } | null;
    }>
  ).map((c) => ({
    id: c.id,
    name: c.role === "ready_to_assign" ? "Ready to Assign" : c.name,
    groupName:
      c.role === "ready_to_assign" ? "— Inflows —" : c.category_groups?.name ?? "Other",
  }));

  return (
    <div className="max-w-2xl pt-12">
      <AccountDetailHeader
        accountId={id}
        accountName={categoryName ? `${categoryName} — ${account.name}` : (account.name as string)}
        registerClearedBalanceCents={registerClearedBalanceCents}
        isLinked={account.is_linked as boolean}
        bankBalanceCents={account.balance_cents as number | null}
        backHref="/accounts"
        isActive={account.is_active as boolean}
        canClose={closure.eligible}
        closeBlockReason={closeBlockReason}
      />

      {/* Balance summary */}
      <AccountBalanceSummary
        subtitle={subtitle}
        workingBalanceCents={workingCents}
        clearedCents={registerClearedBalanceCents}
        unclearedCents={unclearedCents}
      />

      {registerTxns.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">No transactions.</p>
      ) : (
        <RegisterTransactionList
          accountId={id}
          transactions={registerTxns}
          categories={categoryOptions}
          accounts={accountOptions}
        />
      )}

      <AccountAddTransaction
        accountId={id}
        accounts={accountOptions}
        categories={categoryOptions}
      />
    </div>
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function RegisterSkeleton() {
  return (
    <div className="pt-12">
      <div className="animate-pulse p-4 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-14 bg-muted rounded" />
        ))}
      </div>
    </div>
  );
}
