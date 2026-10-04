"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { StickyHeader } from "@/components/ui/sticky-header";
import { AllTransactionsList } from "@/components/transactions/all-transactions-list";
import { useAllTransactions, monthToDateRange } from "@/lib/queries/transactions";
import { useHasMounted } from "@/lib/use-has-mounted";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const BUDGET_MONTH_RE = /^\d{4}-\d{2}-01$/;

// Read-only drill-down from the plan page: one category, one month. The URL
// is the only source of truth (no filter state), so it can't drift or be
// cleared — unlike the general /transactions search page.
export default function CategoryTransactionsPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <CategoryTransactionsContent />
    </Suspense>
  );
}

function CategoryTransactionsContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const rawMonth = searchParams.get("month");
  const month = rawMonth && BUDGET_MONTH_RE.test(rawMonth) ? rawMonth : null;
  const hasMounted = useHasMounted();

  const range = month ? monthToDateRange(month) : null;
  const { data: response, isPending } = useAllTransactions({
    categoryId: id,
    dateFrom: range?.dateFrom,
    dateTo: range?.dateTo,
  });

  const categoryName = hasMounted
    ? (response?.categoryOptions.find((c) => c.id === id)?.name ?? "Category")
    : "Category";
  const txns = hasMounted ? (response?.txns ?? []) : [];
  const monthLabel = month
    ? `${MONTH_NAMES[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}`
    : "All time";
  const backHref = month ? `/budget?month=${month}` : "/budget";
  const currentUrl = `/budget/category/${id}${month ? `?month=${month}` : ""}`;

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
        <Skeleton />
      ) : txns.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">No transactions.</p>
      ) : (
        <AllTransactionsList
          transactions={txns}
          categories={response?.categoryOptions ?? []}
          accounts={response?.accountOptions ?? []}
          backHref={currentUrl}
        />
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse p-4 space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-12 bg-muted rounded" />
      ))}
    </div>
  );
}
