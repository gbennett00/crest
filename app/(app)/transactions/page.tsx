"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, X } from "lucide-react";
import { StickyHeader } from "@/components/ui/sticky-header";
import { AllTransactionsList } from "@/components/transactions/all-transactions-list";
import { SearchComboBox } from "@/components/transactions/search-combobox";
import {
  useAllTransactions,
  type SearchScope,
  type TransactionsFilters,
} from "@/lib/queries/transactions";
import { useHasMounted } from "@/lib/use-has-mounted";
import { cn } from "@/lib/utils";

type FiltersState = {
  q: string;
  scope: SearchScope;
  account: string;
  category: string;
  dateFrom: string;
  dateTo: string;
};

const EMPTY_FILTERS: FiltersState = {
  q: "",
  scope: "all",
  account: "",
  category: "",
  dateFrom: "",
  dateTo: "",
};

function isSearchScope(v: string): v is SearchScope {
  return v === "all" || v === "payee" || v === "category" || v === "memo";
}

function readFiltersFromParams(params: URLSearchParams): FiltersState {
  const scope = params.get("scope") ?? "all";
  return {
    q: params.get("q") ?? "",
    scope: isSearchScope(scope) ? scope : "all",
    account: params.get("account") ?? "",
    category: params.get("category") ?? "",
    dateFrom: params.get("dateFrom") ?? "",
    dateTo: params.get("dateTo") ?? "",
  };
}

function filtersToQueryString(f: FiltersState): string {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.q && f.scope !== "all") params.set("scope", f.scope);
  if (f.account) params.set("account", f.account);
  if (f.category) params.set("category", f.category);
  if (f.dateFrom) params.set("dateFrom", f.dateFrom);
  if (f.dateTo) params.set("dateTo", f.dateTo);
  return params.toString();
}

function toResourceFilters(f: FiltersState): TransactionsFilters {
  return {
    q: f.q || undefined,
    scope: f.q ? f.scope : undefined,
    accountId: f.account || undefined,
    categoryId: f.category || undefined,
    dateFrom: f.dateFrom || undefined,
    dateTo: f.dateTo || undefined,
  };
}

function selectClass(extra?: string) {
  return cn(
    "rounded-md border border-input bg-background px-2.5 py-1.5 text-sm",
    "focus:outline-none focus:ring-1 focus:ring-ring",
    extra,
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
    !!committed.q || !!committed.account || !!committed.category || !!committed.dateFrom || !!committed.dateTo;

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

        <SearchComboBox
          q={draft.q}
          scope={draft.scope}
          categoryId={draft.category}
          categoryOptions={categoryOptions}
          onQueryChange={(q) => setDraft((d) => ({ ...d, q, category: "" }))}
          onScopeSelect={(scope) => setDraft((d) => ({ ...d, scope, category: "" }))}
          onCategorySelect={(id) => setDraft((d) => ({ ...d, category: id, q: "", scope: "all" }))}
          onClear={() => setDraft((d) => ({ ...d, q: "", scope: "all", category: "" }))}
        />

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
