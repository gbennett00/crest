"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Money } from "@/components/money";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { StickyHeader } from "@/components/ui/sticky-header";
import { useTransactionsByCategory } from "@/lib/queries/transactions";
import { prefetchTransactionDetail } from "@/lib/queries/transaction-detail";
import { useHasMounted } from "@/lib/use-has-mounted";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function TransactionsPage() {
  return (
    <Suspense fallback={<div className="animate-pulse p-4 space-y-3">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-12 bg-muted rounded" />)}</div>}>
      <TransactionsContent />
    </Suspense>
  );
}

function TransactionsContent() {
  const searchParams = useSearchParams();
  const categoryId = searchParams.get("category") ?? "";
  const monthFilter = searchParams.get("month") ?? undefined;
  const queryClient = useQueryClient();
  const hasMounted = useHasMounted();

  const { data: response, isPending } = useTransactionsByCategory(categoryId, monthFilter);

  // Gated on hasMounted (see lib/use-has-mounted.ts) so this never differs
  // from the server's necessarily-cache-blind first render, even when the
  // query cache is already warm (e.g. from the row's hover-prefetch).
  const categoryName = hasMounted ? (response?.categoryName ?? "Category") : "Category";
  const txns = hasMounted ? (response?.txns ?? []) : [];

  const monthLabel = monthFilter
    ? `${MONTH_NAMES[+monthFilter.slice(5, 7) - 1]} ${monthFilter.slice(0, 4)}`
    : "All time";

  const backHref = monthFilter ? `/budget?month=${monthFilter}` : "/budget";

  return (
    <div className="max-w-2xl">
      <StickyHeader className="px-4 py-3 flex items-center gap-3">
        <Link href={backHref} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft size={20} />
        </Link>
        <div className="min-w-0">
          <h1 className="font-semibold text-sm truncate">{categoryName}</h1>
          <p className="text-xs text-muted-foreground">{monthLabel}</p>
        </div>
      </StickyHeader>

      {!hasMounted || (isPending && !response) ? (
        <div className="animate-pulse p-4 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 bg-muted rounded" />
          ))}
        </div>
      ) : txns.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">No transactions.</p>
      ) : (
        txns.map((txn, i) => {
          const isApproved = !!txn.approved_at;
          const accountsData = Array.isArray(txn.accounts) ? txn.accounts[0] : txn.accounts;
          const accountName = accountsData?.name ?? "Unknown";

          // The category's share of this transaction (summed in case a split
          // allocated to the same category more than once).
          const categoryAmountCents = (txn.transaction_allocations ?? []).reduce(
            (s, a) => s + a.amount_cents,
            0,
          );

          const currentUrl = `/transactions?category=${categoryId}&month=${monthFilter ?? ""}`;
          const editHref = `/transactions/${txn.id}?back=${encodeURIComponent(currentUrl)}`;
          const prefetch = () => prefetchTransactionDetail(queryClient, txn.id);
          return (
            <Link
              key={`${txn.id}-${i}`}
              href={editHref}
              onMouseEnter={prefetch}
              onFocus={prefetch}
              onPointerDown={prefetch}
              className="px-4 py-3 border-b flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors"
            >
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
