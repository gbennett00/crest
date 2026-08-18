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

  const [categoryRes, txnRes] = await Promise.all([
    categoryId
      ? supabase.from("categories").select("id, name").eq("id", categoryId).single()
      : Promise.resolve({ data: null, error: null }),
    categoryId
      ? supabase
          .from("transaction_allocations")
          .select("amount_cents, transactions(id, payee, amount_cents, txn_date, approved_at, cleared_at, memo, accounts!transactions_account_id_fkey(name))")
          .eq("category_id", categoryId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const categoryName = (categoryRes.data as { name: string } | null)?.name ?? "Category";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allocs = (txnRes.data ?? []) as any[];

  if (monthFilter) {
    const [y, m] = monthFilter.split("-").map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    allocs = allocs.filter((a) => {
      const t = Array.isArray(a.transactions) ? a.transactions[0] : a.transactions;
      const d = (t?.txn_date ?? "") as string;
      return d >= monthFilter && d < nextMonth;
    });
  }

  allocs.sort((a, b) => {
    const ta = Array.isArray(a.transactions) ? a.transactions[0] : a.transactions;
    const tb = Array.isArray(b.transactions) ? b.transactions[0] : b.transactions;
    return ((tb?.txn_date ?? "") as string).localeCompare((ta?.txn_date ?? "") as string);
  });

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

      {allocs.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">No transactions.</p>
      ) : (
        allocs.map((alloc, i) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const txn: any = Array.isArray(alloc.transactions) ? alloc.transactions[0] : alloc.transactions;
          if (!txn) return null;
          const isApproved = !!txn.approved_at;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const accountsData: any = Array.isArray(txn.accounts) ? txn.accounts[0] : txn.accounts;
          const accountName = (accountsData as { name: string } | null)?.name ?? "Unknown";

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
                  alloc.amount_cents < 0 ? "text-destructive" : "text-green-600 dark:text-green-400",
                )}
              >
                <Money cents={alloc.amount_cents} />
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
