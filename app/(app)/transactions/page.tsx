"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, X } from "lucide-react";
import { StickyHeader } from "@/components/ui/sticky-header";
import { AllTransactionsList } from "@/components/transactions/all-transactions-list";
import { SearchBox } from "@/components/transactions/search-box";
import { FiltersMenu } from "@/components/transactions/filters-menu";
import { useAllTransactions, type TransactionsFilters } from "@/lib/queries/transactions";
import { useHasMounted } from "@/lib/use-has-mounted";

type FiltersState = {
  q: string;
  account: string;
  // Only ever arrives via URL (the budget screen's category drill-down) —
  // there's no direct UI control for it, just the chip that shows/clears it.
  category: string;
  amountMin: string;
  amountMax: string;
  dateFrom: string;
  dateTo: string;
};

const EMPTY_FILTERS: FiltersState = {
  q: "",
  account: "",
  category: "",
  amountMin: "",
  amountMax: "",
  dateFrom: "",
  dateTo: "",
};

function readFiltersFromParams(params: URLSearchParams): FiltersState {
  return {
    q: params.get("q") ?? "",
    account: params.get("account") ?? "",
    category: params.get("category") ?? "",
    amountMin: params.get("amountMin") ?? "",
    amountMax: params.get("amountMax") ?? "",
    dateFrom: params.get("dateFrom") ?? "",
    dateTo: params.get("dateTo") ?? "",
  };
}

function filtersToQueryString(f: FiltersState): string {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.account) params.set("account", f.account);
  if (f.category) params.set("category", f.category);
  if (f.amountMin) params.set("amountMin", f.amountMin);
  if (f.amountMax) params.set("amountMax", f.amountMax);
  if (f.dateFrom) params.set("dateFrom", f.dateFrom);
  if (f.dateTo) params.set("dateTo", f.dateTo);
  return params.toString();
}

function toResourceFilters(f: FiltersState): TransactionsFilters {
  return {
    q: f.q || undefined,
    accountId: f.account || undefined,
    categoryId: f.category || undefined,
    amountMin: f.amountMin || undefined,
    amountMax: f.amountMax || undefined,
    dateFrom: f.dateFrom || undefined,
    dateTo: f.dateTo || undefined,
  };
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={<TransactionsSkeleton />}>
      <TransactionsContent />
    </Suspense>
  );
}

function TransactionsContent() {
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

  // Filters live in client state, not in Next's router (same reasoning as
  // `month` in budget-screen.tsx): going through `router.replace` re-enters
  // this route's Suspense boundary on every commit, which briefly shows the
  // fallback and resets the filter controls mid-edit. The plain history API
  // updates the address bar without touching the router, so the inputs never
  // unmount. `replaceState` (not `pushState`) so a burst of typing doesn't
  // spam browser history with one entry per debounced keystroke.
  useEffect(() => {
    const qs = filtersToQueryString(committed);
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }, [committed, pathname]);

  // Browser back/forward moves the URL without going through the state
  // setters above; sync filters to match.
  useEffect(() => {
    function onPopState() {
      const next = readFiltersFromParams(new URLSearchParams(window.location.search));
      setDraft(next);
      setCommitted(next);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const { data: response, isPending } = useAllTransactions(toResourceFilters(committed));

  const txns = hasMounted ? (response?.txns ?? []) : [];
  const accountOptions = hasMounted ? (response?.accountOptions ?? []) : [];
  const categoryOptions = hasMounted ? (response?.categoryOptions ?? []) : [];
  const hasMore = hasMounted && !!response?.hasMore;

  const hasActiveFilters =
    !!committed.q ||
    !!committed.account ||
    !!committed.category ||
    !!committed.amountMin ||
    !!committed.amountMax ||
    !!committed.dateFrom ||
    !!committed.dateTo;

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setCommitted(EMPTY_FILTERS);
  }

  // The category chip's own "x" clears just that field, immediately (not
  // debounced) — it's a discrete click, not something that benefits from
  // waiting out a typing pause.
  function clearCategory() {
    setDraft((d) => ({ ...d, category: "" }));
    setCommitted((c) => ({ ...c, category: "" }));
  }

  const categoryChipName = committed.category
    ? (categoryOptions.find((c) => c.id === committed.category)?.name ?? "Category")
    : null;

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

        <div className="flex items-center gap-2">
          <SearchBox value={draft.q} onChange={(q) => setDraft((d) => ({ ...d, q }))} />

          <FiltersMenu
            accountId={draft.account}
            dateFrom={draft.dateFrom}
            dateTo={draft.dateTo}
            amountMin={draft.amountMin}
            amountMax={draft.amountMax}
            accountOptions={accountOptions}
            onAccountChange={(v) => setDraft((d) => ({ ...d, account: v }))}
            onDateFromChange={(v) => setDraft((d) => ({ ...d, dateFrom: v }))}
            onDateToChange={(v) => setDraft((d) => ({ ...d, dateTo: v }))}
            onAmountMinChange={(v) => setDraft((d) => ({ ...d, amountMin: v }))}
            onAmountMaxChange={(v) => setDraft((d) => ({ ...d, amountMax: v }))}
          />
        </div>

        {hasActiveFilters && (
          <div className="flex justify-end mt-2">
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <X size={13} /> Clear filters
            </button>
          </div>
        )}

        {categoryChipName && (
          <div className="flex items-center gap-1.5 mt-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted pl-2.5 pr-1.5 py-1 text-xs font-medium">
              {categoryChipName}
              <button
                type="button"
                onClick={clearCategory}
                aria-label="Remove category filter"
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={11} />
              </button>
            </span>
          </div>
        )}
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
