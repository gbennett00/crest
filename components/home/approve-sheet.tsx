"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Search, Split, X } from "lucide-react";

import { Sheet } from "@/components/ui/sheet";
import { useFormattedCents } from "@/components/money";
import { cn } from "@/lib/utils";
import { runOptimistic } from "@/lib/queries/optimistic";
import { transactionPatch } from "@/lib/queries/txn-patch";
import { startFlow } from "@/lib/perf";
import { prefetchTransactionDetail } from "@/lib/queries/transaction-detail";
import {
  approveSplitTransaction,
  bulkApproveTransactions,
} from "@/app/(app)/transactions/actions";
import {
  linesForCategories,
  linesFromAllocations,
  splitProblem,
  toAllocations,
  type SplitLine,
} from "@/lib/budget/split";
import { Button } from "@/components/ui/button";
import type { PendingTransaction } from "@/lib/budget";
import type { CategoryOption } from "@/components/transactions/transaction-form";
import { CategoryList, CategoryRow } from "@/components/transactions/category-list";
import { formatShortDate } from "./format";
import { SplitAmounts, SplitCategoryPicker } from "./split-steps";

/**
 * The approve drawer: tapping a pending row on Home opens this short sheet
 * with the payee's most used categories. Tapping one selects it; the check
 * in the header approves with it and X cancels. Focusing the search field
 * grows the drawer in place into every category (suggested first, then each
 * group in Plan order), browsable without typing; typing filters it. Picking
 * one, or Cancel, returns to the short drawer with the pick selected.
 *
 * Split (YNAB-style) is two steps in place: choose the categories (the
 * selected one pre-ticked), then enter an amount for each; the check approves
 * once they add up. A row that is already split opens straight on its
 * amounts. The full edit page is one link away for memo or amount changes.
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
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  // Start on the row's current category only if it can still be shown and
  // picked (a suggestion into a since-hidden category can't).
  const [selectedId, setSelectedId] = useState<string | null>(
    txn.categoryId && byId.has(txn.categoryId) ? txn.categoryId : null,
  );
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [step, setStep] = useState<"main" | "split-pick" | "split-amounts">("main");
  const [chosenIds, setChosenIds] = useState<string[]>([]);
  const [lines, setLines] = useState<SplitLine[]>([]);
  const totalAbsCents = Math.abs(txn.amountCents);
  const searchRef = useRef<HTMLInputElement>(null);

  // Already split across categories: approving with nothing picked keeps the
  // split; picking a category replaces it.
  const splitCount = txn.allocationCount > 1 ? txn.allocationCount : 0;

  const suggestions = useMemo(
    () =>
      txn.suggestedCategoryIds
        .map((id) => byId.get(id))
        .filter((c): c is CategoryOption => !!c),
    [txn.suggestedCategoryIds, byId],
  );
  // The last category picked from the full list that isn't a suggestion. It
  // gets its own section (never shown as suggested) and stays there after
  // tapping a suggestion, so the user can switch back to it.
  const [browsedPickId, setBrowsedPickId] = useState<string | null>(null);
  const picked = browsedPickId ? (byId.get(browsedPickId) ?? null) : null;

  function leaveBrowse() {
    setBrowsing(false);
    setQuery("");
    searchRef.current?.blur();
  }

  function pick(categoryId: string) {
    setSelectedId(categoryId);
    if (!suggestions.some((c) => c.id === categoryId)) setBrowsedPickId(categoryId);
    leaveBrowse();
  }

  function startSplit() {
    const existing = linesFromAllocations(txn.allocations);
    // Already split, into categories that can all still be shown: go
    // straight to the amounts, filled in.
    if (existing.length > 1 && existing.every((l) => byId.has(l.categoryId))) {
      setLines(existing);
      setChosenIds(existing.map((l) => l.categoryId));
      setStep("split-amounts");
      return;
    }
    setChosenIds(selectedId ? [selectedId] : []);
    setLines([]);
    setStep("split-pick");
  }

  function toggleChosen(categoryId: string) {
    setChosenIds((ids) =>
      ids.includes(categoryId) ? ids.filter((id) => id !== categoryId) : [...ids, categoryId],
    );
  }

  function toAmounts() {
    setLines((prev) => linesForCategories(chosenIds, prev));
    setStep("split-amounts");
  }

  function approveSplit() {
    if (splitProblem(totalAbsCents, lines)) return;
    runOptimistic(queryClient, {
      patch: transactionPatch([
        {
          id: txn.id,
          approved: true,
          allocations: toAllocations(lines, txn.amountCents).map((a) => ({
            ...a,
            name: byId.get(a.categoryId)?.name ?? "Unknown",
          })),
        },
      ]),
      action: () => approveSplitTransaction(txn.id, lines),
      errorOf: (result) => result.error ?? null,
      failure: { title: `Couldn’t approve ${txn.payee}.` },
      flow: startFlow("approve-sheet-split", { optimistic: true, lines: lines.length }),
    });
    onClose();
  }

  // The row leaves the list as the drawer closes; the server write follows
  // and is rolled back with a banner if it fails (lib/queries/optimistic.ts).
  function approve() {
    if (!selectedId && splitCount === 0) return;
    const picked = selectedId ? byId.get(selectedId) : undefined;
    runOptimistic(queryClient, {
      patch: transactionPatch([
        {
          id: txn.id,
          approved: true,
          category: picked && { id: picked.id, name: picked.name, replace: "all" },
        },
      ]),
      action: () =>
        selectedId
          ? bulkApproveTransactions([txn.id], selectedId, { replace: "all" })
          : bulkApproveTransactions([txn.id], null),
      errorOf: (result) =>
        result.error ?? (result.updated === 0 ? "The server skipped it." : null),
      failure: { title: `Couldn’t approve ${txn.payee}.` },
      flow: startFlow("approve-sheet", { optimistic: true }),
    });
    onClose();
  }

  const editHref = `/transactions/${txn.id}?back=/`;

  const amountSubtitle = (
    <>
      <span className={cn("num font-semibold", txn.amountCents < 0 ? "text-neg-text" : "text-pos-text")}>
        {txn.amountCents > 0 ? "+" : ""}
        {formatCents(txn.amountCents)}
      </span>
      {" · "}
      {formatShortDate(txn.txnDate)} · {txn.accountName}
    </>
  );

  if (step === "split-pick") {
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={`Split ${txn.payee}`}
        subtitle="Choose the categories to split between"
        centered
        onBack={() => setStep("main")}
        onEscape={(e) => {
          e.preventDefault();
          setStep("main");
        }}
        tall
        className="flex flex-col overflow-hidden pb-0 pt-1"
        footer={
          <Button className="flex-1" disabled={chosenIds.length < 2} onClick={toAmounts}>
            {chosenIds.length < 2
              ? "Choose at least 2"
              : `Next · ${chosenIds.length} categories`}
          </Button>
        }
      >
        <SplitCategoryPicker
          categories={categories}
          byId={byId}
          chosenIds={chosenIds}
          onToggle={toggleChosen}
          suggestedIds={txn.suggestedCategoryIds}
        />
      </Sheet>
    );
  }

  if (step === "split-amounts") {
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={`Split ${txn.payee}`}
        subtitle={amountSubtitle}
        confirm={{
          label: "Approve split",
          onConfirm: approveSplit,
          disabled: splitProblem(totalAbsCents, lines) !== null,
        }}
        onBack={() => setStep("split-pick")}
        onEscape={(e) => {
          e.preventDefault();
          setStep("split-pick");
        }}
        tall
        className="pt-1"
      >
        <SplitAmounts
          lines={lines}
          totalAbsCents={totalAbsCents}
          byId={byId}
          onChange={(index, amountCents) =>
            setLines((prev) => prev.map((l, i) => (i === index ? { ...l, amountCents } : l)))
          }
          onChangeCategories={() => setStep("split-pick")}
        />
      </Sheet>
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={txn.payee}
      subtitle={amountSubtitle}
      confirm={{
        label: "Approve",
        onConfirm: approve,
        disabled: !selectedId && splitCount === 0,
      }}
      onEscape={
        browsing
          ? (e) => {
              e.preventDefault();
              leaveBrowse();
            }
          : undefined
      }
      tall={browsing}
      className={browsing ? "flex flex-col overflow-hidden pb-0 pt-1" : "pt-1"}
    >
      {!browsing && splitCount > 0 && (
        <p className="mt-2 rounded-ds-md bg-brand-subtle px-3.5 py-2.5 text-caption text-ink">
          Split across {splitCount} categories. Approve keeps the split, tap Split to change
          it, or pick a category to replace it.
        </p>
      )}

      {!browsing && picked && (
        <>
          <h3 className="mb-2 mt-2 text-overline uppercase text-ink-muted">From all categories</h3>
          <CategoryOptions options={[picked]} selectedId={selectedId} onSelect={setSelectedId} />
        </>
      )}

      {!browsing &&
        (suggestions.length > 0 ? (
          <>
            <h3 className={cn("mb-2 text-overline uppercase text-ink-muted", picked ? "mt-4" : "mt-2")}>
              Suggested
            </h3>
            <CategoryOptions options={suggestions} selectedId={selectedId} onSelect={setSelectedId} />
            <p className="mt-2 px-0.5 text-caption text-ink-subtle">
              Most used with {txn.payee} in the last 90 days
            </p>
          </>
        ) : (
          !picked && (
            <p className="mt-2 text-caption text-ink-muted">
              No recent categories for {txn.payee}. Search or browse below.
            </p>
          )
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
          <div className="mt-2 flex justify-center gap-2">
            <button
              type="button"
              onClick={startSplit}
              className="inline-flex h-tap items-center gap-1.5 rounded-ds-md px-3 text-body-strong text-brand-text hover:bg-surface"
            >
              <Split size={18} strokeWidth={1.75} aria-hidden />
              Split
            </button>
            <Link
              href={editHref}
              onMouseEnter={() => prefetchTransactionDetail(queryClient, txn.id)}
              onPointerDown={() => prefetchTransactionDetail(queryClient, txn.id)}
              className="inline-flex h-tap items-center gap-1 rounded-ds-md px-3 text-body-strong text-brand-text hover:bg-surface"
            >
              Full edit page
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
      {options.map((c) => (
        <CategoryRow
          key={c.id}
          variant="card"
          label={c.name}
          selected={c.id === selectedId}
          onClick={() => onSelect(c.id)}
        />
      ))}
    </ul>
  );
}
