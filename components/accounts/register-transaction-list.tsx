"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Money } from "@/components/money";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionsBar } from "@/components/transactions/bulk-actions-bar";
import type {
  AccountOption,
  CategoryOption,
} from "@/components/transactions/transaction-form";
import { cn } from "@/lib/utils";

export type RegisterTxn = {
  id: string;
  payee: string | null;
  amountCents: number;
  txnDate: string;
  approved: boolean;
  cleared: boolean;
  reconciled: boolean;
  memo: string | null;
  categoryLabel: string;
};

function formatDateLong(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "long",
    day: "numeric",
  });
}

export function RegisterTransactionList({
  accountId,
  transactions,
  categories,
  accounts,
}: {
  accountId: string;
  transactions: RegisterTxn[];
  categories: CategoryOption[];
  accounts: AccountOption[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reconciled lines are locked; they can't take part in a bulk edit.
  const selectableIds = transactions
    .filter((t) => !t.reconciled)
    .map((t) => t.id);
  const allSelected =
    selectableIds.length > 0 && selected.size === selectableIds.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  // Preserve incoming order (txn_date desc, created desc) while grouping by day.
  const groups: { date: string; txns: RegisterTxn[] }[] = [];
  for (const txn of transactions) {
    const last = groups[groups.length - 1];
    if (last && last.date === txn.txnDate) last.txns.push(txn);
    else groups.push({ date: txn.txnDate, txns: [txn] });
  }

  return (
    <div>
      {/* Select-all control */}
      {selectableIds.length > 0 && (
        <div className="flex items-center gap-2.5 px-4 py-2 border-b bg-muted/10">
          <Checkbox
            checked={allSelected}
            onCheckedChange={toggleAll}
            aria-label="Select all transactions"
          />
          <span className="text-xs text-muted-foreground">
            {selected.size > 0 ? `${selected.size} selected` : "Select all"}
          </span>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.date}>
          {/* Date header */}
          <div className="px-4 py-1.5 bg-muted/30 border-b border-t">
            <p className="text-xs font-medium text-muted-foreground">
              {formatDateLong(group.date)}
            </p>
          </div>
          {group.txns.map((txn) => {
            const isChecked = selected.has(txn.id);
            const editHref = `/transactions/${txn.id}?back=/accounts/${accountId}`;
            return (
              <div
                key={txn.id}
                className={cn(
                  "flex items-stretch border-b",
                  isChecked && "bg-primary/5",
                )}
              >
                {/* Selection checkbox (locked/reconciled lines can't be selected) */}
                <div className="flex items-center pl-4">
                  {txn.reconciled ? (
                    <Lock size={14} className="text-muted-foreground/50" />
                  ) : (
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggle(txn.id)}
                      aria-label={`Select ${txn.payee || "transaction"}`}
                    />
                  )}
                </div>
                <Link
                  href={editHref}
                  className="px-3 py-3 flex-1 flex items-start justify-between gap-3 hover:bg-muted/30 transition-colors min-w-0"
                >
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
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {txn.categoryLabel}
                    </p>
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
                    {/* Cleared / Reconciled indicator */}
                    {txn.reconciled ? (
                      <Lock size={13} className="text-muted-foreground" />
                    ) : txn.cleared ? (
                      <div className="w-3.5 h-3.5 rounded-full bg-green-500" />
                    ) : txn.approved ? (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/40" />
                    ) : null}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      ))}

      <BulkActionsBar
        selectedIds={[...selected]}
        categories={categories}
        accounts={accounts}
        primary={["categorize", "move"]}
        menu={["approve", "delete"]}
        currentAccountId={accountId}
        onClearSelection={() => setSelected(new Set())}
      />
    </div>
  );
}
