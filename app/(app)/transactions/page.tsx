"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Search, X } from "lucide-react";
import { StickyHeader } from "@/components/ui/sticky-header";
import { Input } from "@/components/ui/input";
import { AllTransactionsList } from "@/components/transactions/all-transactions-list";
import { useAllTransactions, type TransactionsFilters } from "@/lib/queries/transactions";
import { useHasMounted } from "@/lib/use-has-mounted";
import { cn } from "@/lib/utils";
import type { CategoryOption } from "@/components/transactions/transaction-form";

type FiltersState = {
  q: string;
  account: string;
  category: string;
  dateFrom: string;
  dateTo: string;
  amount: string;
};

const EMPTY_FILTERS: FiltersState = {
  q: "",
  account: "",
  category: "",
  dateFrom: "",
  dateTo: "",
  amount: "",
};

function readFiltersFromParams(params: URLSearchParams): FiltersState {
  return {
    q: params.get("q") ?? "",
    account: params.get("account") ?? "",
    category: params.get("category") ?? "",
    dateFrom: params.get("dateFrom") ?? "",
    dateTo: params.get("dateTo") ?? "",
    amount: params.get("amount") ?? "",
  };
}

function filtersToQueryString(f: FiltersState): string {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.account) params.set("account", f.account);
  if (f.category) params.set("category", f.category);
  if (f.dateFrom) params.set("dateFrom", f.dateFrom);
  if (f.dateTo) params.set("dateTo", f.dateTo);
  if (f.amount) params.set("amount", f.amount);
  return params.toString();
}

function toResourceFilters(f: FiltersState): TransactionsFilters {
  return {
    q: f.q || undefined,
    accountId: f.account || undefined,
    categoryId: f.category || undefined,
    dateFrom: f.dateFrom || undefined,
    dateTo: f.dateTo || undefined,
    amount: f.amount || undefined,
  };
}

function selectClass(extra?: string) {
  return cn(
    "rounded-md border border-input bg-background px-2.5 py-1.5 text-sm",
    "focus:outline-none focus:ring-1 focus:ring-ring",
    extra,
  );
}

function GroupedCategoryFilter({
  value,
  onChange,
  categories,
}: {
  value: string;
  onChange: (v: string) => void;
  categories: CategoryOption[];
}) {
  const grouped = useMemo(() => {
    const g: Record<string, CategoryOption[]> = {};
    for (const c of categories) (g[c.groupName] ??= []).push(c);
    return g;
  }, [categories]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={selectClass("min-w-0")}
      aria-label="Filter by category"
    >
      <option value="">All categories</option>
      {Object.entries(grouped).map(([group, cats]) => (
        <optgroup key={group} label={group}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<TransactionsSkeleton />}>
      <TransactionsContent />
    </Suspense>
  );
}

function TransactionsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasMounted = useHasMounted();

  // Frozen at first render: the budget screen's category drill-down always
  // arrives with both `category` and `dateFrom` set, and is the only entry
  // point that wants a "back to budget" chevron instead of the plain header.
  const [initialCategory] = useState(() => searchParams.get("category"));
  const [initialDateFrom] = useState(() => searchParams.get("dateFrom"));
  const cameFromBudget = !!initialCategory && !!initialDateFrom;
  // /budget expects the full `YYYY-MM-01` DATE form (see BUDGET_MONTH_RE in
  // app/(app)/budget/page.tsx), not a bare `YYYY-MM`.
  const backHref = cameFromBudget ? `/budget?month=${initialDateFrom!.slice(0, 7)}-01` : null;

  // `draft` is what the controls show and updates on every keystroke/change.
  // `committed` only catches up ~300ms after `draft` goes quiet, and is what
  // actually drives the URL and the query — so typing feels instant without
  // firing a request (or a URL write) per keystroke. Routing every field
  // through one draft/commit pair (instead of a debounce timer per field)
  // means there's a single writer for the URL, so two filters changed in
  // quick succession can never race and clobber each other.
  const [draft, setDraft] = useState<FiltersState>(() => readFiltersFromParams(searchParams));
  const [committed, setCommitted] = useState<FiltersState>(draft);

  useEffect(() => {
    const handle = setTimeout(() => setCommitted(draft), 300);
    return () => clearTimeout(handle);
  }, [draft]);

  useEffect(() => {
    const qs = filtersToQueryString(committed);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed]);

  const { data: response, isPending } = useAllTransactions(toResourceFilters(committed));

  const txns = hasMounted ? (response?.txns ?? []) : [];
  const accountOptions = hasMounted ? (response?.accountOptions ?? []) : [];
  const categoryOptions = hasMounted ? (response?.categoryOptions ?? []) : [];
  const hasMore = hasMounted && !!response?.hasMore;

  const hasActiveFilters =
    !!committed.q ||
    !!committed.account ||
    !!committed.category ||
    !!committed.dateFrom ||
    !!committed.dateTo ||
    !!committed.amount;

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setCommitted(EMPTY_FILTERS);
  }

  const currentUrl = `${pathname}${filtersToQueryString(committed) ? `?${filtersToQueryString(committed)}` : ""}`;

  return (
    <div className="max-w-2xl">
      <StickyHeader className="px-4 py-3">
        <div className="flex items-center gap-3 mb-3">
          {backHref && (
            <Link href={backHref} className="text-muted-foreground hover:text-foreground shrink-0">
              <ChevronLeft size={20} />
            </Link>
          )}
          <h1 className="font-semibold text-sm">Transactions</h1>
        </div>

        <div className="relative">
          <Search
            size={15}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
            placeholder="Search payee or memo…"
            className="pl-8"
            aria-label="Search payee or memo"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <select
            value={draft.account}
            onChange={(e) => setDraft((d) => ({ ...d, account: e.target.value }))}
            className={selectClass()}
            aria-label="Filter by account"
          >
            <option value="">All accounts</option>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <GroupedCategoryFilter
            value={draft.category}
            onChange={(v) => setDraft((d) => ({ ...d, category: v }))}
            categories={categoryOptions}
          />

          <input
            type="date"
            value={draft.dateFrom}
            onChange={(e) => setDraft((d) => ({ ...d, dateFrom: e.target.value }))}
            className={selectClass()}
            aria-label="From date"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={draft.dateTo}
            onChange={(e) => setDraft((d) => ({ ...d, dateTo: e.target.value }))}
            className={selectClass()}
            aria-label="To date"
          />

          <input
            type="text"
            inputMode="decimal"
            value={draft.amount}
            onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
            placeholder="Amount"
            className={selectClass("w-24")}
            aria-label="Filter by amount"
          />

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground ml-auto"
            >
              <X size={13} /> Clear filters
            </button>
          )}
        </div>
      </StickyHeader>

      {!hasMounted || (isPending && !response) ? (
        <TransactionsSkeleton />
      ) : txns.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">
          {hasActiveFilters ? "No transactions match your filters." : "No transactions yet."}
        </p>
      ) : (
        <>
          <AllTransactionsList
            transactions={txns}
            categories={categoryOptions}
            accounts={accountOptions}
            backHref={currentUrl}
          />
          {hasMore && (
            <p className="text-center text-xs text-muted-foreground py-4">
              Showing the most recent {txns.length} matching transactions. Narrow your filters to see more.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function TransactionsSkeleton() {
  return (
    <div className="animate-pulse p-4 space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-12 bg-muted rounded" />
      ))}
    </div>
  );
}
