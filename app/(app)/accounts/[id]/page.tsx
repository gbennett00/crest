import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/format";
import { sumClearedTransactionAmounts, approximateAvailableCents } from "@/lib/ledger";
import { cn } from "@/lib/utils";
import { Lock } from "lucide-react";
import { AccountDetailHeader } from "@/components/accounts/account-detail-header";

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

  const [accountRes, txnsRes, allTxnAmountsRes, categoriesRes] = await Promise.all([
    supabase.from("accounts").select("id, name, type, balance_cents, is_linked").eq("id", id).single(),
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
    supabase.from("categories").select("id, name").not("role", "eq", "ready_to_assign"),
  ]);

  if (accountRes.error || !accountRes.data) {
    return (
      <div className="p-4">
        <p className="text-destructive text-sm">Account not found.</p>
      </div>
    );
  }

  const account = accountRes.data;
  const balanceCents = account.balance_cents as number;

  // Compute balance summaries
  const allLines = (allTxnAmountsRes.data ?? []).map((r) => ({
    amountCents: r.amount_cents as number,
    clearedAt: r.cleared_at as string | null,
  }));
  const registerClearedBalanceCents = sumClearedTransactionAmounts(allLines);
  const approxAvailableCents = approximateAvailableCents(balanceCents, allLines);

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

  // Group transactions by date
  const grouped: Record<string, typeof txns> = {};
  for (const txn of txns) {
    (grouped[txn.txn_date as string] ??= []).push(txn);
  }
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const subtitle = monthFilter
    ? `${MONTH_NAMES[+monthFilter.slice(5, 7) - 1]} ${monthFilter.slice(0, 4)}`
    : "All transactions";

  return (
    <div className="max-w-2xl pt-12">
      <AccountDetailHeader
        accountId={id}
        accountName={categoryName ? `${categoryName} — ${account.name}` : (account.name as string)}
        registerClearedBalanceCents={registerClearedBalanceCents}
        bankClearedBalanceCents={balanceCents}
        backHref="/accounts"
      />

      {/* Balance summary */}
      <div className="px-4 py-4 border-b bg-muted/20">
        <p className="text-xs text-muted-foreground text-center mb-1">{subtitle}</p>
        <div className="flex justify-center gap-6">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Statement</p>
            <p className="text-sm font-semibold tabular-nums">{formatCents(balanceCents)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Cleared</p>
            <p className="text-sm font-semibold tabular-nums">{formatCents(registerClearedBalanceCents)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Available</p>
            <p className={cn("text-sm font-semibold tabular-nums", approxAvailableCents < 0 && "text-destructive")}>
              {formatCents(approxAvailableCents)}
            </p>
          </div>
        </div>
      </div>

      {txns.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">No transactions.</p>
      ) : (
        <div>
          {dates.map((date) => (
            <div key={date}>
              {/* Date header */}
              <div className="px-4 py-1.5 bg-muted/30 border-b border-t">
                <p className="text-xs font-medium text-muted-foreground">
                  {formatDateLong(date)}
                </p>
              </div>
              {/* Transactions for this date */}
              {grouped[date].map((txn) => {
                const isApproved = !!txn.approved_at;
                const isCleared = !!txn.cleared_at;
                const isReconciled = !!txn.reconciled_at;
                const allocs: { category_id: string; amount_cents: number; categories: { name: string } | null }[] =
                  txn.transaction_allocations ?? [];
                const categoryLabel = allocs.length === 0
                  ? "Uncategorized"
                  : allocs.length === 1
                    ? allocs[0].categories?.name ?? "Unknown"
                    : `Split (${allocs.length})`;

                const editHref = `/transactions/${txn.id}?back=/accounts/${id}`;
                return (
                  <Link
                    key={txn.id}
                    href={editHref}
                    className="px-4 py-3 border-b flex items-start justify-between gap-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {!isApproved && (
                          <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium shrink-0">
                            Pending
                          </span>
                        )}
                        <span className="text-sm font-medium truncate">{txn.payee || "—"}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {categoryLabel}
                      </p>
                      {txn.memo && (
                        <p className="text-xs text-muted-foreground italic mt-0.5 truncate">{txn.memo}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={cn(
                          "text-sm font-medium tabular-nums",
                          txn.amount_cents < 0 ? "text-destructive" : "text-green-600 dark:text-green-400",
                        )}
                      >
                        {formatCents(txn.amount_cents)}
                      </span>
                      {/* Cleared / Reconciled indicator */}
                      {isReconciled ? (
                        <Lock size={13} className="text-muted-foreground" />
                      ) : isCleared ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-green-500" />
                      ) : isApproved ? (
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/40" />
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDateLong(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
  });
}

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
