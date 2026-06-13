"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createManualTransaction } from "@/app/(app)/accounts/actions";
import { Plus, X } from "lucide-react";

export type AccountOption = { id: string; name: string };
export type CategoryOption = { id: string; name: string; groupName: string };

export function AddTransactionForm({
  accounts,
  categories,
  defaultAccountId,
  initialOpen = false,
  onSuccess,
  embedded = false,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  defaultAccountId?: string;
  initialOpen?: boolean;
  onSuccess?: () => void;
  // When rendered inside another modal (e.g. the home Add Transaction sheet),
  // skip this component's own card wrapper, header, and close button.
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [direction, setDirection] = useState<"outflow" | "inflow">("outflow");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const today = new Date().toISOString().slice(0, 10);

  async function handleSubmit(formData: FormData) {
    setError(null);
    formData.set("direction", direction);
    startTransition(async () => {
      const result = await createManualTransaction(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        if (onSuccess) {
          onSuccess();
        } else {
          setOpen(false);
        }
        setDirection("outflow");
        formRef.current?.reset();
      }
    });
  }

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

  return (
    <div className={embedded ? "px-3 pt-2 space-y-4" : "border rounded-lg p-4 space-y-4"}>
      {!embedded && (
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">New Transaction</h3>
          <button
            onClick={() => { setOpen(false); setError(null); }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <form ref={formRef} action={handleSubmit} className="space-y-2.5">
        {/* Row 1: Account + Date */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="txn-account" className="text-xs">Account</Label>
            <select
              id="txn-account"
              name="accountId"
              defaultValue={defaultAccountId ?? ""}
              required
              className={cn(
                "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm",
                "focus:outline-none focus:ring-1 focus:ring-ring",
              )}
            >
              <option value="" disabled>Select…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="txn-date" className="text-xs">Date</Label>
            <Input id="txn-date" name="txnDate" type="date" defaultValue={today} required className="h-8 text-sm" />
          </div>
        </div>

        {/* Row 2: Payee */}
        <div className="space-y-1">
          <Label htmlFor="txn-payee" className="text-xs">Payee</Label>
          <Input id="txn-payee" name="payee" placeholder="e.g. Grocery Store" className="h-8 text-sm" />
        </div>

        {/* Row 3: Amount + direction */}
        <div className="space-y-1">
          <Label className="text-xs">Amount</Label>
          <div className="flex gap-2">
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
                  "px-2.5 py-1.5 transition-colors",
                  direction === "inflow"
                    ? "bg-green-600 text-white"
                    : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                In
              </button>
            </div>
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required className="h-8 pl-6 text-sm" />
            </div>
          </div>
        </div>

        {/* Row 4: Category */}
        <div className="space-y-1">
          <Label htmlFor="txn-category" className="text-xs">
            Category <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <select
            id="txn-category"
            name="categoryId"
            className={cn(
              "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm",
              "focus:outline-none focus:ring-1 focus:ring-ring",
            )}
          >
            <option value="">No category (approve later)</option>
            {Object.entries(
              categories.reduce<Record<string, CategoryOption[]>>((acc, c) => {
                (acc[c.groupName] ??= []).push(c);
                return acc;
              }, {}),
            ).map(([group, cats]) => (
              <optgroup key={group} label={group}>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" className="w-full h-8 text-sm" disabled={isPending}>
          {isPending ? "Creating…" : "Create Transaction"}
        </Button>
      </form>
    </div>
  );
}
