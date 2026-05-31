"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createManualAccount } from "@/app/(app)/accounts/actions";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function AddAccountForm() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"checking" | "savings" | "credit">(
    "checking",
  );
  const [accountName, setAccountName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createManualAccount(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setOpen(false);
        setAccountName("");
        setType("checking");
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
        Add Account
      </Button>
    );
  }

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">New Account</h3>
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

      <form ref={formRef} action={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="acc-name" className="text-xs">
            Account Name
          </Label>
          <Input
            id="acc-name"
            name="name"
            placeholder="e.g. Chase Checking"
            required
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            className="h-9"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="acc-type" className="text-xs">
            Account Type
          </Label>
          <select
            id="acc-type"
            name="type"
            value={type}
            onChange={(e) =>
              setType(e.target.value as "checking" | "savings" | "credit")
            }
            className={cn(
              "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
              "focus:outline-none focus:ring-1 focus:ring-ring",
            )}
          >
            <option value="checking">Checking</option>
            <option value="savings">Savings</option>
            <option value="credit">Credit Card</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="acc-balance" className="text-xs">
            {type === "credit" ? "Current Balance Owed ($)" : "Opening Balance ($)"}
          </Label>
          <Input
            id="acc-balance"
            name="openingBalance"
            type="number"
            step="0.01"
            placeholder="0.00"
            className="h-9"
          />
          {type === "credit" && (
            <p className="text-xs text-muted-foreground">
              Enter the amount you currently owe. Use a positive number.
            </p>
          )}
        </div>

        {type === "credit" && (
          <div className="space-y-1.5">
            <Label htmlFor="acc-pay-cat" className="text-xs">
              Payment Category Name
            </Label>
            <Input
              id="acc-pay-cat"
              name="paymentCategoryName"
              placeholder={accountName ? `${accountName} Payment` : "Card Payment"}
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">
              A budget category for tracking this card&apos;s payments.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button
          type="submit"
          className="w-full h-9"
          disabled={isPending}
        >
          {isPending ? "Creating…" : "Create Account"}
        </Button>
      </form>
    </div>
  );
}
