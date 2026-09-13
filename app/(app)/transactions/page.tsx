import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Money } from "@/components/money";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; month?: string }>;
}) {
  return (
    <Suspense fallback={<div className="pt-12 animate-pulse p-4 space-y-3">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 bg-muted rounded" />)}</div>}>
      <TransactionsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function TransactionsContent({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; month?: string }>;
}) {
  const { category: categoryId, month: monthFilter } = await searchParams;
  const supabase = await createClient();

  // Month bounds for the DB-side filter (half-open [monthFilter, nextMonth)).
  const nextMonth = (() => {
    if (!monthFilter) return null;
    const [y, m] = monthFilter.split("-").map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  })();

  const [categoryRes, txnRes] = await Promise.all([
    categoryId
      ? supabase.from("categories").select("id, name").eq("id", categoryId).single()
      : Promise.resolve({ data: null, error: null }),
    categoryId
      ? (() => {
          // Root at transactions (not allocations) so txn_date is a top-level
          // column we can filter and sort on in Postgres. The !inner join keeps
          // only transactions with an allocation to this category, embedding
          // just that allocation.
          let q = supabase
            .from("transactions")
            .select(
              "id, payee, amount_cents, txn_date, approved_at, cleared_at, memo, " +
                "accounts!transactions_account_id_fkey(name), " +
                "transaction_allocations!inner(amount_cents, category_id)",
            )
            .eq("transaction_allocations.category_id", categoryId)
            .order("txn_date", { ascending: false });
          if (monthFilter && nextMonth) {
            q = q.gte("txn_date", monthFilter).lt("txn_date", nextMonth);
          }
          return q;
        })()
      : Promise.resolve({ data: [], error: null }),
  ]);

  const categoryName = (categoryRes.data as { name: string } | null)?.name ?? "Category";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txns = (txnRes.data ?? []) as any[];

  const monthLabel = monthFilter
    ? `${MONTH_NAMES[+monthFilter.slice(5, 7) - 1]} ${monthFilter.slice(0, 4)}`
    : "All time";

  const backHref = monthFilter ? `/budget?month=${monthFilter}` : "/budget";

  return (
    <div className="max-w-2xl pt-12">
      <div className="sticky top-12 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Link href={backHref} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft size={20} />
        </Link>
        <div className="min-w-0">
          <h1 className="font-semibold text-sm truncate">{categoryName}</h1>
          <p className="text-xs text-muted-foreground">{monthLabel}</p>
        </div>
      </div>

      {txns.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">No transactions.</p>
      ) : (
        txns.map((txn, i) => {
          const isApproved = !!txn.approved_at;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const accountsData: any = Array.isArray(txn.accounts) ? txn.accounts[0] : txn.accounts;
          const accountName = (accountsData as { name: string } | null)?.name ?? "Unknown";

          // The category's share of this transaction (summed in case a split
          // allocated to the same category more than once).
          const categoryAmountCents = (
            (txn.transaction_allocations ?? []) as { amount_cents: number }[]
          ).reduce((s, a) => s + a.amount_cents, 0);

          const currentUrl = `/transactions?category=${categoryId ?? ""}&month=${monthFilter ?? ""}`;
          const editHref = `/transactions/${txn.id}?back=${encodeURIComponent(currentUrl)}`;
          return (
            <Link key={`${txn.id}-${i}`} href={editHref} className="px-4 py-3 border-b flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {!isApproved && (
                    <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium shrink-0">
                      Pending
                    </span>
                  )}
                  <span className="text-sm font-medium">{txn.payee || "—"}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDate(txn.txn_date)} · {accountName}
                </p>
              </div>
              <span
                className={cn(
                  "text-sm font-medium tabular-nums shrink-0",
                  categoryAmountCents < 0 ? "text-destructive" : "text-green-600 dark:text-green-400",
                )}
              >
                <Money cents={categoryAmountCents} />
              </span>
            </Link>
          );
        })
      )}
    </div>
  );
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
