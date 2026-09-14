"use client";

import { useState } from "react";
import { ListChecks, X } from "lucide-react";
import { Money } from "@/components/money";
import { Checkbox } from "@/components/ui/checkbox";
import { ApproveForm, type CategoryOption } from "@/components/home/approve-form";
import { BulkActionsBar } from "@/components/transactions/bulk-actions-bar";
import type { AccountOption } from "@/components/transactions/transaction-form";
import { cn } from "@/lib/utils";

export type PendingRow = {
  id: string;
  payee: string;
  amountCents: number;
  txnDate: string;
  accountName: string;
};

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function PendingApprovalList({
  pending,
  categories,
  accounts,
}: {
  pending: PendingRow[];
  categories: CategoryOption[];
  accounts: AccountOption[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = pending.length > 0 && selected.size === pending.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(pending.map((t) => t.id)));
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  const selectedIds = [...selected];
  const selectedTotalCents = pending.reduce(
    (sum, t) => (selected.has(t.id) ? sum + t.amountCents : sum),
    0,
  );

  return (
    <>
      {/* Select-all control — checkboxes stay hidden until "Select" is tapped,
          so the list reads clean until the user actually wants to multi-select. */}
      <div className="flex items-center gap-2.5 px-4 py-2 border-b bg-muted/10">
        {selectMode ? (
          <>
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              aria-label="Select all pending transactions"
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

      <div className="divide-y">
        {pending.map((txn) => {
          const isChecked = selected.has(txn.id);
          return (
            <div
              key={txn.id}
              className={cn("py-3 px-4", isChecked && "bg-primary/5")}
            >
              <div className="flex items-start gap-3">
                {selectMode && (
                  <div className="pt-0.5">
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggle(txn.id)}
                      aria-label={`Select ${txn.payee}`}
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{txn.payee}</p>
                      <p className="text-xs text-muted-foreground">
                        {txn.accountName} · {formatDate(txn.txnDate)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className={cn(
                          "text-sm font-medium tabular-nums",
                          txn.amountCents < 0
                            ? "text-destructive"
                            : "text-green-600 dark:text-green-400",
                        )}
                      >
                        <Money cents={txn.amountCents} />
                      </p>
                    </div>
                  </div>
                  {categories.length > 0 && (
                    <ApproveForm
                      transactionId={txn.id}
                      amountCents={txn.amountCents}
                      categories={categories}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <BulkActionsBar
        selectedIds={selectedIds}
        selectedTotalCents={selectedTotalCents}
        categories={categories}
        accounts={accounts}
        primary={["approve", "categorize"]}
        menu={["move", "delete"]}
        onClearSelection={exitSelectMode}
      />
    </>
  );
}
