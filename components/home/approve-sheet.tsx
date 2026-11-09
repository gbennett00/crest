"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Search, X } from "lucide-react";

import { Sheet } from "@/components/ui/sheet";
import { useFormattedCents } from "@/components/money";
import { cn } from "@/lib/utils";
import { splitLeadingEmoji } from "@/lib/leading-emoji";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import { prefetchTransactionDetail } from "@/lib/queries/transaction-detail";
import { bulkApproveTransactions } from "@/app/(app)/transactions/actions";
import type { PendingTransaction } from "@/lib/budget";
import type { CategoryOption } from "@/components/transactions/transaction-form";
import { CategoryList } from "@/components/transactions/category-list";
import { formatShortDate } from "./format";

/**
 * The approve drawer: tapping a pending row on Home opens this short sheet
 * with the payee's most used categories. Tapping one selects it; the check
 * in the header approves with it and X cancels. Focusing the search field
 * grows the drawer in place into every category (suggested first, then each
 * group in Plan order), browsable without typing; typing filters it. Picking
 * one, or Cancel, returns to the short drawer with the pick selected. The
 * full edit page is one link away for splits, memo or amount changes.
 */
export function ApproveSheet({
  txn,
  categories,
  onClose,
}: {
  txn: PendingTransaction;
  categories: CategoryOption[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const formatCents = useFormattedCents();
  const [selectedId, setSelectedId] = useState<string | null>(txn.categoryId);
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const suggestions = useMemo(() => {
    const list = txn.suggestedCategoryIds
      .map((id) => byId.get(id))
      .filter((c): c is CategoryOption => !!c);
    // A category picked from search stays visible once the search is cleared.
    const picked = selectedId ? byId.get(selectedId) : undefined;
    if (picked && !list.some((c) => c.id === picked.id)) list.unshift(picked);
    return list;
  }, [txn.suggestedCategoryIds, byId, selectedId]);

  function leaveBrowse() {
    setBrowsing(false);
    setQuery("");
    searchRef.current?.blur();
  }

  function pick(categoryId: string) {
    setSelectedId(categoryId);
    leaveBrowse();
  }

  function approve() {
    if (!selectedId) return;
    setError(null);
    startTransition(async () => {
      const result = await bulkApproveTransactions([txn.id], selectedId, { replace: "all" });
      if (result.error || result.updated === 0) {
        setError(result.error ?? "Couldn’t approve this transaction.");
        return;
      }
      invalidateAllLedgerQueries(queryClient);
      onClose();
    });
  }

  const editHref = `/transactions/${txn.id}?back=/`;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
      title={txn.payee}
      subtitle={
        <>
          <span className={cn("num font-semibold", txn.amountCents < 0 ? "text-neg-text" : "text-pos-text")}>
            {txn.amountCents > 0 ? "+" : ""}
            {formatCents(txn.amountCents)}
          </span>
          {" · "}
          {formatShortDate(txn.txnDate)} · {txn.accountName}
        </>
      }
      confirm={{
        label: isPending ? "Approving" : "Approve",
        onConfirm: approve,
        disabled: !selectedId || isPending,
      }}
      tall={browsing}
      className={browsing ? "flex flex-col overflow-hidden pb-0 pt-1" : "pt-1"}
    >
      {!browsing &&
        (suggestions.length > 0 ? (
          <>
            <h3 className="mb-2 mt-2 text-overline uppercase text-ink-muted">Suggested</h3>
            <CategoryOptions options={suggestions} selectedId={selectedId} onSelect={setSelectedId} />
            <p className="mt-2 px-0.5 text-caption text-ink-subtle">
              Most used with {txn.payee} in the last 90 days
            </p>
          </>
        ) : (
          <p className="mt-2 text-caption text-ink-muted">
            No recent categories for {txn.payee}. Search or browse below.
          </p>
        ))}

      {/* Kept in the same tree position in both modes so focus (and the
          phone keyboard) survives the switch into browsing. */}
      <div className={cn("flex shrink-0 items-center gap-1", browsing ? "mb-3" : "mt-4")}>
        <div className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-ds-md border border-border-strong bg-surface-sunken px-3.5 focus-within:border-focus">
          <Search size={20} strokeWidth={1.75} className="shrink-0 text-ink-subtle" aria-hidden />
          <input
            ref={searchRef}
            value={query}
            onFocus={() => setBrowsing(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setBrowsing(true);
            }}
            placeholder="Search all categories"
            aria-label="Search all categories"
            className="h-full min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-subtle focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
              className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-pill text-ink-muted hover:text-ink"
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          )}
        </div>
        {browsing && (
          <button
            type="button"
            onClick={leaveBrowse}
            className="flex h-tap shrink-0 items-center rounded-ds-md pl-3 pr-1 text-body-strong text-brand-text"
          >
            Cancel
          </button>
        )}
      </div>

      {browsing ? (
        <div className="-mx-5 min-h-0 flex-1 overflow-y-auto overscroll-contain border-t pb-[max(1rem,env(safe-area-inset-bottom))]">
          <CategoryList
            categories={categories}
            value={selectedId}
            onSelect={pick}
            query={query}
            suggestedIds={txn.suggestedCategoryIds}
          />
        </div>
      ) : (
        <>
          {error && <p className="mt-3 text-caption text-neg-text">{error}</p>}
          <div className="mt-2 flex justify-center">
            <Link
              href={editHref}
              onMouseEnter={() => prefetchTransactionDetail(queryClient, txn.id)}
              onPointerDown={() => prefetchTransactionDetail(queryClient, txn.id)}
              className="inline-flex h-tap items-center gap-1 rounded-ds-md px-3 text-body-strong text-brand-text hover:bg-surface"
            >
              Open full edit page
              <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
            </Link>
          </div>
        </>
      )}
    </Sheet>
  );
}

function CategoryOptions({
  options,
  selectedId,
  onSelect,
}: {
  options: CategoryOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {options.map((c) => {
        const { emoji, label } = splitLeadingEmoji(c.name);
        const on = c.id === selectedId;
        return (
          <li key={c.id}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onSelect(c.id)}
              className={cn(
                "flex min-h-[52px] w-full items-center gap-3 rounded-ds-md border px-3.5 text-left text-body font-medium text-ink transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                on ? "border-brand-text bg-brand-subtle" : "border-border bg-surface hover:bg-surface-sunken",
              )}
            >
              {emoji && (
                <span aria-hidden="true" className="w-[26px] shrink-0 text-center text-xl">
                  {emoji}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {on && <Check size={20} strokeWidth={2.25} className="shrink-0 text-brand-text" aria-hidden />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
