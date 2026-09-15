"use client";

import { useState } from "react";
import Link from "next/link";
import { ListChecks, Lock, X } from "lucide-react";
import { Money } from "@/components/money";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionsBar } from "@/components/transactions/bulk-actions-bar";
import type {
  AccountOption,
  CategoryOption,
} from "@/components/transactions/transaction-form";
import { cn } from "@/lib/utils";

export type ReportTxn = {
  id: string;
  payee: string | null;
  amountCents: number;
  txnDate: string;
  approved: boolean;
  cleared: boolean;
  reconciled: boolean;
  memo: string | null;
  accountName: string;
};

function formatDateLong(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
  });
}

/**
 * Transaction list for the report drill-down panel — same "Select" → checkbox
 * rows → sticky BulkActionsBar interaction as the account register
 * (RegisterTransactionList) and the home pending-approval list, just fed by a
 * category+period filter instead of one account.
 */
export function ReportTransactionList({
  transactions,
  categories,
  accounts,
  backHref,
}: {
  transactions: ReportTxn[];
  categories: CategoryOption[];
  accounts: AccountOption[];
  /** Where a row's edit link returns to (the reports URL, panel state included). */
  backHref: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  const allIds = transactions.map((t) => t.id);
  const allSelected = allIds.length > 0 && selected.size === allIds.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  const selectedTotalCents = transactions.reduce(
    (sum, t) => (selected.has(t.id) ? sum + t.amountCents : sum),
    0,
  );
  const lockedSelectedCount = transactions.reduce(
    (n, t) => (selected.has(t.id) && t.reconciled ? n + 1 : n),
    0,
  );

  const groups: { date: string; txns: ReportTxn[] }[] = [];
  for (const txn of transactions) {
    const last = groups[groups.length - 1];
    if (last && last.date === txn.txnDate) last.txns.push(txn);
    else groups.push({ date: txn.txnDate, txns: [txn] });
  }

  return (
    <div className="pb-24">
      {allIds.length > 0 && (
        <div className="flex items-center gap-2.5 px-4 py-2 border-b bg-muted/10 sticky top-0 z-10">
          {selectMode ? (
            <>
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleAll}
                aria-label="Select all transactions"
              />
              <span className="text-xs text-muted-foreground flex-1">
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </span>
              <button
                type="button"
                onClick={exitSelectMode}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <X size={13} /> Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <ListChecks size={13} /> Select
            </button>
          )}
        </div>
      )}

      {transactions.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">No transactions.</p>
      ) : (
        groups.map((group) => (
          <div key={group.date}>
            <div className="px-4 py-1.5 bg-muted/30 border-b border-t">
              <p className="text-xs font-medium text-muted-foreground">
                {formatDateLong(group.date)}
              </p>
            </div>
            {group.txns.map((txn) => {
              const isChecked = selected.has(txn.id);
              const editHref = `/transactions/${txn.id}?back=${encodeURIComponent(backHref)}`;
              const rowContent = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {!txn.approved && (
                        <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium shrink-0">
                          Pending
                        </span>
                      )}
                      <span className="text-sm font-medium truncate">
                        {txn.payee || "—"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{txn.accountName}</p>
                    {txn.memo && (
                      <p className="text-xs text-muted-foreground italic mt-0.5 truncate">
                        {txn.memo}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        "text-sm font-medium tabular-nums",
                        txn.amountCents < 0
                          ? "text-destructive"
                          : "text-green-600 dark:text-green-400",
                      )}
                    >
                      <Money cents={txn.amountCents} />
                    </span>
                    {txn.reconciled ? (
                      <Lock size={13} className="text-muted-foreground" />
                    ) : txn.cleared ? (
                      <div className="w-3.5 h-3.5 rounded-full bg-green-500" />
                    ) : txn.approved ? (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/40" />
                    ) : null}
                  </div>
                </>
              );
              const rowClass =
                "px-3 py-3 flex-1 flex items-start justify-between gap-3 hover:bg-muted/30 transition-colors min-w-0 text-left";
              return (
                <div
                  key={txn.id}
                  className={cn(
                    "flex items-stretch border-b",
                    isChecked && "bg-primary/5",
                  )}
                >
                  {selectMode && (
                    <div className="flex items-center pl-4">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggle(txn.id)}
                        aria-label={`Select ${txn.payee || "transaction"}`}
                      />
                    </div>
                  )}
                  {selectMode ? (
                    <button type="button" onClick={() => toggle(txn.id)} className={rowClass}>
                      {rowContent}
                    </button>
                  ) : (
                    <Link href={editHref} className={rowClass}>
                      {rowContent}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}

      <BulkActionsBar
        selectedIds={[...selected]}
        selectedTotalCents={selectedTotalCents}
        lockedCount={lockedSelectedCount}
        categories={categories}
        accounts={accounts}
        primary={["categorize", "move"]}
        menu={["approve", "delete"]}
        onClearSelection={exitSelectMode}
      />
    </div>
  );
}
