"use client";

import React, { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  deleteTransactionAction,
  saveTransaction,
} from "@/app/(app)/transactions/actions";
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
  reconciledAt: string | null;
  transferAccountId: string | null;
  isApproved: boolean;
  categoryId: string | null;
  allocations: AllocationData[];
};

export type AccountOption = { id: string; name: string };
export type CategoryOption = { id: string; name: string; groupName: string };

type Direction = "outflow" | "inflow" | "transfer";

const selectClass = cn(
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
  "focus:outline-none focus:ring-1 focus:ring-ring h-9",
);

export function TransactionForm({
  accounts,
  categories,
  txn,
  defaultAccountId,
  backHref,
  onSuccess,
  initialOpen = false,
  embedded = false,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  txn?: TransactionEditData | null;
  defaultAccountId?: string;
  backHref?: string;
  onSuccess?: () => void;
  initialOpen?: boolean;
  // When rendered inside another modal (e.g. the home Add Transaction sheet),
  // skip this component's own card wrapper, header, and close button.
  embedded?: boolean;
}) {
  const isEdit = !!txn;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const pendingForm = useRef<FormData | null>(null);

  const [open, setOpen] = useState(initialOpen || isEdit);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showReconcileConfirm, setShowReconcileConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  // ---- Initial values derived from an existing transaction (edit mode) ----
  const initialDirection: Direction = txn
    ? txn.transferAccountId
      ? "transfer"
      : txn.amountCents < 0
        ? "outflow"
        : "inflow"
    : "outflow";
  const initialAmount = txn ? (Math.abs(txn.amountCents) / 100).toFixed(2) : "";

  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [amount, setAmount] = useState(initialAmount);
  const [cleared, setCleared] = useState(txn ? !!txn.clearedAt : true);

  const isTransfer = direction === "transfer";
  const sign = direction === "inflow" ? 1 : -1;
  const totalAbsCents = Math.round((parseFloat(amount) || 0) * 100);

  // ---- Split state (absolute dollars; sign re-applied on submit) ----
  const [isSplit, setIsSplit] = useState((txn?.allocations.length ?? 0) > 1);
  const [splits, setSplits] = useState<{ categoryId: string; amount: string }[]>(
    () =>
      (txn?.allocations.length ?? 0) > 1
        ? txn!.allocations.map((a) => ({
            categoryId: a.categoryId,
            amount: (Math.abs(a.amountCents) / 100).toFixed(2),
          }))
        : [],
  );

  const splitTotalCents = splits.reduce(
    (s, row) => s + Math.round((parseFloat(row.amount) || 0) * 100),
    0,
  );
  const remainingCents = totalAbsCents - splitTotalCents;

  function enterSplitMode() {
    // Seed with the current single category (full amount) plus an empty row.
    setSplits([
      { categoryId: txn?.categoryId ?? "", amount: amount || "" },
      { categoryId: "", amount: "" },
    ]);
    setIsSplit(true);
    setError(null);
  }

  function exitSplitMode() {
    setIsSplit(false);
    setError(null);
  }

  function updateSplit(
    index: number,
    patch: Partial<{ categoryId: string; amount: string }>,
  ) {
    setSplits((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addSplitRow() {
    const prefill = remainingCents > 0 ? (remainingCents / 100).toFixed(2) : "";
    setSplits((prev) => [...prev, { categoryId: "", amount: prefill }]);
  }

  function removeSplitRow(index: number) {
    setSplits((prev) => prev.filter((_, i) => i !== index));
  }

  const groupedCategories = categories.reduce<Record<string, CategoryOption[]>>(
    (acc, c) => {
      (acc[c.groupName] ??= []).push(c);
      return acc;
    },
    {},
  );

  function resetAfterCreate() {
    setDirection("outflow");
    setAmount("");
    setCleared(true);
    setIsSplit(false);
    setSplits([]);
    formRef.current?.reset();
  }

  // Builds the FormData and runs client-side validation. Returns null on error.
  function buildFormData(form: HTMLFormElement): FormData | null {
    const formData = new FormData(form);
    formData.set("direction", direction);
    formData.set("cleared", String(cleared));

    if (!isTransfer) {
      if (isSplit) {
        if (splits.some((s) => !s.categoryId)) {
          setError("Every split needs a category.");
          return null;
        }
        if (splits.some((s) => !(parseFloat(s.amount) > 0))) {
          setError("Every split needs an amount greater than zero.");
          return null;
        }
        if (remainingCents !== 0) {
          const off = (Math.abs(remainingCents) / 100).toFixed(2);
          const total = (totalAbsCents / 100).toFixed(2);
          setError(
            remainingCents > 0
              ? `Splits are $${off} short of the $${total} total.`
              : `Splits exceed the $${total} total by $${off}.`,
          );
          return null;
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
          categoryId
            ? JSON.stringify([
                { categoryId, amountCents: sign * totalAbsCents },
              ])
            : "[]",
        );
      }
    }

    return formData;
  }

  function doSave(formData: FormData) {
    startTransition(async () => {
      const result = await saveTransaction(formData);
      if (result?.error) {
        setError(result.error);
      } else if (isEdit) {
        router.push(backHref ?? "/accounts");
        router.refresh();
      } else if (onSuccess) {
        onSuccess();
        resetAfterCreate();
      } else {
        setOpen(false);
        resetAfterCreate();
      }
    });
  }

  function doDelete() {
    startTransition(async () => {
      const result = await deleteTransactionAction(txn!.id);
      if (result?.error) {
        setError(result.error);
        setShowDeleteConfirm(false);
      } else {
        router.push(backHref ?? "/accounts");
        router.refresh();
      }
    });
  }

  // Confirmation shared by the normal edit form and the transfer view.
  const deleteDialog = (
    <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
          <AlertDialogDescription>
            {txn?.transferAccountId
              ? "This permanently removes the transfer, including its matching line in the other account. This can’t be undone."
              : "This permanently removes the transaction. This can’t be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={doDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = buildFormData(e.currentTarget);
    if (!formData) return;

    // Warn before editing a reconciled transaction.
    if (isEdit && txn?.reconciledAt) {
      pendingForm.current = formData;
      setShowReconcileConfirm(true);
      return;
    }
    doSave(formData);
  }

  // ---- Existing transfer: not editable in this iteration ----
  if (isEdit && txn?.transferAccountId) {
    const fromName =
      accounts.find((a) => a.id === txn.accountId)?.name ?? "account";
    const toName =
      accounts.find((a) => a.id === txn.transferAccountId)?.name ?? "account";
    const out = txn.amountCents < 0;
    return (
      <div className="p-4 space-y-4 max-w-lg">
        <div className="rounded-lg border p-4 space-y-2 bg-muted/20">
          <p className="text-sm font-medium">Transfer</p>
          <p className="text-sm text-muted-foreground">
            {out ? `${fromName} → ${toName}` : `${toName} → ${fromName}`}
          </p>
          <p className="text-base font-semibold tabular-nums">
            ${(Math.abs(txn.amountCents) / 100).toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground">{txn.txnDate}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Editing existing transfers isn&apos;t supported yet.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(backHref ?? "/accounts")}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete
          </Button>
        </div>
        {deleteDialog}
      </div>
    );
  }

  // ---- Collapsed "Add Transaction" button (create on the accounts page) ----
  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Plus size={14} />
        Add Transaction
      </Button>
    );
  }

  const directionToggle = (
    <div className="flex rounded-md border border-input overflow-hidden text-xs shrink-0">
      <button
        type="button"
        onClick={() => setDirection("outflow")}
        className={cn(
          "px-2.5 py-1.5 transition-colors",
          direction === "outflow"
            ? "bg-destructive text-destructive-foreground"
            : "bg-background text-muted-foreground hover:bg-muted",
        )}
      >
        Out
      </button>
      <button
        type="button"
        onClick={() => setDirection("inflow")}
        className={cn(
          "px-2.5 py-1.5 transition-colors border-l border-input",
          direction === "inflow"
            ? "bg-green-600 text-white"
            : "bg-background text-muted-foreground hover:bg-muted",
        )}
      >
        In
      </button>
      <button
        type="button"
        onClick={() => setDirection("transfer")}
        className={cn(
          "px-2.5 py-1.5 transition-colors border-l border-input",
          isTransfer
            ? "bg-primary text-primary-foreground"
            : "bg-background text-muted-foreground hover:bg-muted",
        )}
      >
        Transfer
      </button>
    </div>
  );

  const fields = (
    <>
      {/* Account + Date */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="txn-account" className="text-xs">
            {isTransfer ? "From" : "Account"}
          </Label>
          <select
            id="txn-account"
            name="accountId"
            defaultValue={txn?.accountId ?? defaultAccountId ?? ""}
            required
            className={selectClass}
          >
            <option value="" disabled>
              Select…
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="txn-date" className="text-xs">
            Date
          </Label>
          <Input
            id="txn-date"
            name="txnDate"
            type="date"
            defaultValue={txn?.txnDate ?? today}
            required
            className="h-9"
          />
        </div>
      </div>

      {/* Payee — transfers derive their payee from the linked account */}
      {!isTransfer && (
        <div className="space-y-1.5">
          <Label htmlFor="txn-payee" className="text-xs">
            Payee
          </Label>
          <Input
            id="txn-payee"
            name="payee"
            defaultValue={txn?.payee ?? ""}
            placeholder="e.g. Grocery Store"
            className="h-9"
          />
        </div>
      )}

      {/* Amount + direction */}
      <div className="space-y-1.5">
        <Label className="text-xs">Amount</Label>
        <div className="flex gap-2">
          {directionToggle}
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              $
            </span>
            <Input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-9 pl-6 tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* To account (transfer) or Category (normal) */}
      {isTransfer ? (
        <div className="space-y-1.5">
          <Label htmlFor="txn-to-account" className="text-xs">
            To
          </Label>
          <select
            id="txn-to-account"
            name="toAccountId"
            defaultValue=""
            required
            className={selectClass}
          >
            <option value="" disabled>
              Select…
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="categoryId" className="text-xs">
              Category{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
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
              defaultValue={txn?.categoryId ?? ""}
              className={selectClass}
            >
              <option value="">No category (approve later)</option>
              {Object.entries(groupedCategories).map(([group, cats]) => (
                <optgroup key={group} label={group}>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
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
                    onChange={(e) =>
                      updateSplit(i, { categoryId: e.target.value })
                    }
                    className={cn(
                      "flex-1 min-w-0 rounded-md border border-input bg-background px-2 py-2 text-sm",
                      "focus:outline-none focus:ring-1 focus:ring-ring h-9",
                    )}
                  >
                    <option value="">Select category…</option>
                    {Object.entries(groupedCategories).map(([group, cats]) => (
                      <optgroup key={group} label={group}>
                        {cats.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <div className="relative w-28 shrink-0">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      $
                    </span>
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
                    remainingCents === 0
                      ? "text-muted-foreground"
                      : "text-destructive",
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
      )}

      {/* Memo */}
      <div className="space-y-1.5">
        <Label htmlFor="memo" className="text-xs">
          Memo{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Input
          id="memo"
          name="memo"
          defaultValue={txn?.memo ?? ""}
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
        <Label
          className="text-sm cursor-pointer"
          onClick={() => setCleared(!cleared)}
        >
          Cleared
        </Label>
        {cleared && (
          <span className="text-xs text-muted-foreground">
            Bank has processed this transaction
          </span>
        )}
      </div>
    </>
  );

  const reconcileDialog = (
    <AlertDialog
      open={showReconcileConfirm}
      onOpenChange={setShowReconcileConfirm}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Edit a reconciled transaction?</AlertDialogTitle>
          <AlertDialogDescription>
            This transaction has been reconciled. Changing it may put the
            account out of balance with your bank. Are you sure you want to
            continue?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (pendingForm.current) doSave(pendingForm.current);
              pendingForm.current = null;
            }}
          >
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  // ---- Edit mode: full-page form with a sticky Save/Cancel header ----
  if (isEdit) {
    return (
      <form
        id="edit-txn-form"
        ref={formRef}
        onSubmit={handleSubmit}
        className="p-4 space-y-4 max-w-lg"
      >
        <input type="hidden" name="txnId" value={txn!.id} />

        <div className="sticky top-[109px] z-10 bg-background -mx-4 px-4 pb-3 pt-1 border-b flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-3 text-sm text-destructive hover:text-destructive"
            disabled={isPending}
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-8 px-3 text-sm"
              onClick={() => router.push(backHref ?? "/accounts")}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-8 px-4" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>

        {fields}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {reconcileDialog}
        {deleteDialog}
      </form>
    );
  }

  // ---- Create mode ----
  return (
    <div
      className={
        embedded ? "px-3 pt-2 space-y-4" : "border rounded-lg p-4 space-y-4"
      }
    >
      {!embedded && (
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">New Transaction</h3>
          <button
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-2.5">
        {fields}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button
          type="submit"
          className="w-full h-9 text-sm"
          disabled={isPending}
        >
          {isPending
            ? "Saving…"
            : isTransfer
              ? "Create Transfer"
              : "Create Transaction"}
        </Button>
      </form>
    </div>
  );
}
