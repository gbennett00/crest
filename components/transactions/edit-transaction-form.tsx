"use client";

import React, { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveTransaction } from "@/app/(app)/transactions/actions";


export type TransactionEditData = {
  id: string;
  payee: string;
  txnDate: string;
  accountId: string;
  amountCents: number;
  memo: string | null;
  clearedAt: string | null;
  isApproved: boolean;
  isSplit: boolean;
  categoryId: string | null;
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
  const absAmount = (Math.abs(txn.amountCents) / 100).toFixed(2);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("cleared", String(cleared));
    setError(null);
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
            {txn.isSplit && <span className="ml-2 text-xs font-normal text-muted-foreground">(split)</span>}
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

      {/* Category */}
      <div className="space-y-1.5">
        <Label htmlFor="categoryId" className="text-xs">
          Category
          {txn.isSplit && (
            <span className="ml-1.5 text-muted-foreground font-normal">(split — editing will replace with single category)</span>
          )}
        </Label>
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
