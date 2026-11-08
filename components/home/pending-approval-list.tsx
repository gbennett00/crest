"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { TransactionRow } from "@/components/ui/transaction-row";
import { BulkActionsBar } from "@/components/transactions/bulk-actions-bar";
import { prefetchTransactionDetail } from "@/lib/queries/transaction-detail";
import { planBulkApproval } from "@/lib/budget/approval";
import type { PendingTransaction } from "@/lib/budget";
import type {
  AccountOption,
  CategoryOption,
} from "@/components/transactions/transaction-form";
import { ApproveSheet } from "./approve-sheet";
import { HomeCard, CountBadge } from "./home-card";
import { formatShortDate } from "./format";

/**
 * Home's "New transactions" card. Tapping a row opens the approve drawer
 * (suggested categories, search, link to the full editor). "Select" turns on
 * checkboxes for bulk Approve: when every selected row has a category each
 * keeps its own; otherwise one chosen category goes on all of them,
 * prefilled when the existing ones agree.
 */
export function PendingApprovalList({
  pending,
  categories,
  accounts,
}: {
  pending: PendingTransaction[];
  categories: CategoryOption[];
  accounts: AccountOption[];
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Rows can disappear underneath (approved elsewhere, refetch): keep only
  // ids still on screen.
  const visibleSelected = useMemo(
    () => pending.filter((t) => selected.has(t.id)),
    [pending, selected],
  );
  const openTxn = pending.find((t) => t.id === openId) ?? null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = pending.length > 0 && visibleSelected.length === pending.length;

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  const plan = planBulkApproval(
    visibleSelected.map((t) => ({
      categoryId: t.categoryId,
      categorized: t.categoryLabel !== null,
    })),
  );
  const selectedTotalCents = visibleSelected.reduce((sum, t) => sum + t.amountCents, 0);

  return (
    <HomeCard
      id="pending"
      title="New transactions"
      badge={<CountBadge tone="warn" count={pending.length} />}
      action={
        selectMode ? (
          <div className="flex items-center gap-1">
            <Button
              variant="quiet"
              size="sm"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(pending.map((t) => t.id)))
              }
            >
              {allSelected ? "None" : "All"}
            </Button>
            <Button variant="quiet" size="sm" onClick={exitSelectMode}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="quiet" size="sm" onClick={() => setSelectMode(true)}>
            Select
          </Button>
        )
      }
    >
      <ul className="divide-y">
        {pending.map((txn) => (
          <li key={txn.id}>
            <TransactionRow
              payee={txn.payee}
              meta={`${formatShortDate(txn.txnDate)} · ${txn.accountName}`}
              amountCents={txn.amountCents}
              category={txn.categoryLabel}
              suggested={txn.suggested}
              pending
              selecting={selectMode}
              selected={selected.has(txn.id)}
              onClick={() => (selectMode ? toggle(txn.id) : setOpenId(txn.id))}
              onIntent={
                selectMode ? undefined : () => prefetchTransactionDetail(queryClient, txn.id)
              }
            />
          </li>
        ))}
      </ul>

      {openTxn && (
        <ApproveSheet
          key={openTxn.id}
          txn={openTxn}
          categories={categories}
          onClose={() => setOpenId(null)}
        />
      )}

      <BulkActionsBar
        selectedIds={visibleSelected.map((t) => t.id)}
        selectedTotalCents={selectedTotalCents}
        uncategorizedCount={plan.kind === "as-is" ? 0 : visibleSelected.filter((t) => t.categoryLabel === null).length}
        approveAppliesToAll
        approvePrefillCategoryId={plan.kind === "choose" ? plan.prefillCategoryId : null}
        categories={categories}
        accounts={accounts}
        primary={["approve"]}
        menu={["move", "delete"]}
        onClearSelection={exitSelectMode}
      />
    </HomeCard>
  );
}
