"use client";

import React, { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveTransaction } from "@/app/(app)/transactions/actions";
import { Plus, X } from "lucide-react";


export type AllocationData = { categoryId: string; amountCents: number };

export type TransactionEditData = {
  id: string;
  payee: string;
  txnDate: string;
  accountId: string;
  amountCents: number;
  memo: string | null;
  clearedAt: string | null;
  isApproved: boolean;
  categoryId: string | null;
  allocations: AllocationData[];
};

export type AccountOption = { id: string; name: string };
export type CategoryOption = { id: string; name: string; groupName: string };

export function EditTransactionForm({
  txn,
  accounts,
  categories,
  backHref,
}: {
  txn: TransactionEditData;
  accounts: AccountOption[];
  categories: CategoryOption[];
  backHref: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [cleared, setCleared] = useState(!!txn.clearedAt);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const isOutflow = txn.amountCents < 0;
  const sign = isOutflow ? -1 : 1;
  const totalAbsCents = Math.abs(txn.amountCents);
  const absAmount = (totalAbsCents / 100).toFixed(2);

  // Split state. A "split row" carries a category plus an absolute dollar amount.
  // We work in absolute dollars in the UI and re-apply the transaction's sign on submit.
  const [isSplit, setIsSplit] = useState(txn.allocations.length > 1);
  const [splits, setSplits] = useState<{ categoryId: string; amount: string }[]>(() =>
    txn.allocations.length > 1
      ? txn.allocations.map((a) => ({
          categoryId: a.categoryId,
          amount: (Math.abs(a.amountCents) / 100).toFixed(2),
        }))
      : [],
  );

  const splitTotalCents = splits.reduce(
    (sum, s) => sum + Math.round((parseFloat(s.amount) || 0) * 100),
    0,
  );
  const remainingCents = totalAbsCents - splitTotalCents;

  function enterSplitMode() {
    // Seed with the current single category (full amount) plus an empty row to fill in.
    setSplits([
      { categoryId: txn.categoryId ?? "", amount: absAmount },
      { categoryId: "", amount: "" },
    ]);
    setIsSplit(true);
    setError(null);
  }

  function exitSplitMode() {
    setIsSplit(false);
    setError(null);
  }

  function updateSplit(index: number, patch: Partial<{ categoryId: string; amount: string }>) {
    setSplits((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addSplitRow() {
    // Pre-fill the new row's amount with whatever is left to allocate.
    const prefill = remainingCents > 0 ? (remainingCents / 100).toFixed(2) : "";
    setSplits((prev) => [...prev, { categoryId: "", amount: prefill }]);
  }

  function removeSplitRow(index: number) {
    setSplits((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("cleared", String(cleared));
    setError(null);

    if (isSplit) {
      if (splits.some((s) => !s.categoryId)) {
        setError("Every split needs a category.");
        return;
      }
      if (splits.some((s) => !(parseFloat(s.amount) > 0))) {
        setError("Every split needs an amount greater than zero.");
        return;
      }
      if (remainingCents !== 0) {
        const off = (Math.abs(remainingCents) / 100).toFixed(2);
        setError(
          remainingCents > 0
            ? `Splits are $${off} short of the $${absAmount} total.`
            : `Splits exceed the $${absAmount} total by $${off}.`,
        );
        return;
      }
      const allocations: AllocationData[] = splits.map((s) => ({
        categoryId: s.categoryId,
        amountCents: sign * Math.round(parseFloat(s.amount) * 100),
      }));
      formData.set("allocations", JSON.stringify(allocations));
    } else {
      const categoryId = (formData.get("categoryId") as string) || "";
      formData.set(
        "allocations",
        categoryId ? JSON.stringify([{ categoryId, amountCents: txn.amountCents }]) : "[]",
      );
    }

    startTransition(async () => {
      const result = await saveTransaction(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        router.push(backHref);
        router.refresh();
      }
    });
  }

  const groupedCategories = categories.reduce<Record<string, CategoryOption[]>>((acc, c) => {
    (acc[c.groupName] ??= []).push(c);
    return acc;
  }, {});

  return (
    <form id="edit-txn-form" ref={formRef} onSubmit={handleSubmit} className="p-4 space-y-4 max-w-lg">
      <input type="hidden" name="txnId" value={txn.id} />
      <input type="hidden" name="amountCents" value={txn.amountCents} />

      {/* Amount + sticky action buttons — sticky so Save is always visible while scrolling */}
      <div className="sticky top-[109px] z-10 bg-background -mx-4 px-4 pb-3 pt-1 border-b flex items-center gap-3">
        <div className="rounded-lg border p-2.5 bg-muted/20 flex-1">
          <p className="text-xs text-muted-foreground">Amount</p>
          <p className={cn("text-base font-semibold tabular-nums", isOutflow ? "text-destructive" : "text-green-600 dark:text-green-400")}>
            {isOutflow ? "-" : "+"}${absAmount}
            {isSplit && <span className="ml-2 text-xs font-normal text-muted-foreground">(split)</span>}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-3 text-sm"
            onClick={() => router.push(backHref)}
          >
            Cancel
          </Button>
          <Button type="submit" className="h-8 px-4">Save</Button>
        </div>
      </div>

      {/* Payee */}
      <div className="space-y-1.5">
        <Label htmlFor="payee" className="text-xs">Payee</Label>
        <Input
          id="payee"
          name="payee"
          defaultValue={txn.payee}
          placeholder="Payee"
          className="h-9"
        />
      </div>

      {/* Date */}
      <div className="space-y-1.5">
        <Label htmlFor="txnDate" className="text-xs">Date</Label>
        <Input
          id="txnDate"
          name="txnDate"
          type="date"
          defaultValue={txn.txnDate}
          required
          className="h-9"
        />
      </div>

      {/* Account */}
      <div className="space-y-1.5">
        <Label htmlFor="accountId" className="text-xs">Account</Label>
        <select
          id="accountId"
          name="accountId"
          defaultValue={txn.accountId}
          required
          className={cn(
            "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
            "focus:outline-none focus:ring-1 focus:ring-ring h-9",
          )}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* Category — single select, or a list of split rows */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="categoryId" className="text-xs">Category</Label>
          {isSplit ? (
            <button
              type="button"
              onClick={exitSplitMode}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Remove split
            </button>
          ) : (
            <button
              type="button"
              onClick={enterSplitMode}
              className="text-xs text-primary hover:underline"
            >
              Split transaction
            </button>
          )}
        </div>

        {!isSplit ? (
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={txn.categoryId ?? ""}
            className={cn(
              "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
              "focus:outline-none focus:ring-1 focus:ring-ring h-9",
            )}
          >
            <option value="">No category (pending)</option>
            {Object.entries(groupedCategories).map(([group, cats]) => (
              <optgroup key={group} label={group}>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <div className="space-y-2">
            {splits.map((s, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select
                  value={s.categoryId}
                  onChange={(e) => updateSplit(i, { categoryId: e.target.value })}
                  className={cn(
                    "flex-1 min-w-0 rounded-md border border-input bg-background px-2 py-2 text-sm",
                    "focus:outline-none focus:ring-1 focus:ring-ring h-9",
                  )}
                >
                  <option value="">Select category…</option>
                  {Object.entries(groupedCategories).map(([group, cats]) => (
                    <optgroup key={group} label={group}>
                      {cats.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className="relative w-28 shrink-0">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={s.amount}
                    onChange={(e) => updateSplit(i, { amount: e.target.value })}
                    className="h-9 pl-6 text-sm tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeSplitRow(i)}
                  disabled={splits.length <= 2}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground shrink-0"
                  aria-label="Remove split"
                >
                  <X size={16} />
                </button>
              </div>
            ))}

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={addSplitRow}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus size={14} />
                Add split
              </button>
              <span
                className={cn(
                  "text-xs tabular-nums",
                  remainingCents === 0 ? "text-muted-foreground" : "text-destructive",
                )}
              >
                {remainingCents === 0
                  ? "Fully allocated"
                  : remainingCents > 0
                    ? `$${(remainingCents / 100).toFixed(2)} remaining`
                    : `$${(Math.abs(remainingCents) / 100).toFixed(2)} over`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Memo */}
      <div className="space-y-1.5">
        <Label htmlFor="memo" className="text-xs">Memo <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input
          id="memo"
          name="memo"
          defaultValue={txn.memo ?? ""}
          placeholder="Add a note"
          className="h-9"
        />
      </div>

      {/* Cleared toggle */}
      <div className="flex items-center gap-3 py-1">
        <button
          type="button"
          role="switch"
          aria-checked={cleared}
          onClick={() => setCleared(!cleared)}
          className={cn(
            "relative w-9 h-5 rounded-full transition-colors shrink-0",
            cleared ? "bg-primary" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
              cleared && "translate-x-4",
            )}
          />
        </button>
        <Label className="text-sm cursor-pointer" onClick={() => setCleared(!cleared)}>
          Cleared
        </Label>
        {cleared && (
          <span className="text-xs text-muted-foreground">Bank has processed this transaction</span>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
