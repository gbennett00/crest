"use client";

import { useRef, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import { createManualAccount } from "@/app/(app)/accounts/actions";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TRACKING_ACCOUNT_TYPES } from "@/lib/ledger/types";

// Trigger renders as a plain icon button (for inline placement next to a page
// title) when `iconOnly` is set; the form itself always opens in a modal.
type AccountFormType = "checking" | "savings" | "credit" | "asset" | "liability";
const isTrackingType = (t: AccountFormType) =>
  (TRACKING_ACCOUNT_TYPES as readonly string[]).includes(t);

export function AddAccountForm({ iconOnly = false }: { iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AccountFormType>("checking");
  const [accountName, setAccountName] = useState("");
  const [openingBalanceCents, setOpeningBalanceCents] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();

  function close() {
    setOpen(false);
    setError(null);
    setAccountName("");
    setType("checking");
    setOpeningBalanceCents(0);
    formRef.current?.reset();
  }

  async function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createManualAccount(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        invalidateAllLedgerQueries(queryClient);
        close();
      }
    });
  }

  return (
    <>
      {iconOnly ? (
        <button
          onClick={() => setOpen(true)}
          aria-label="Add account"
          title="Add account"
          className="p-2 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Plus size={18} />
        </button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setOpen(true)}
        >
          <Plus size={14} />
          Add Account
        </Button>
      )}

      <Modal open={open} onClose={close} title="New Account">
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
              onChange={(e) => setType(e.target.value as AccountFormType)}
              className={cn(
                "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                "focus:outline-none focus:ring-1 focus:ring-ring",
              )}
            >
              <optgroup label="Budget">
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit">Credit Card</option>
              </optgroup>
              <optgroup label="Tracking">
                <option value="asset">Asset (e.g. investment, property)</option>
                <option value="liability">Liability (e.g. loan, mortgage)</option>
              </optgroup>
            </select>
            {isTrackingType(type) && (
              <p className="text-xs text-muted-foreground">
                Tracking accounts show up in net worth but not the budget —
                their transactions are never categorized.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acc-balance" className="text-xs">
              {type === "credit" || type === "liability"
                ? "Current Balance Owed ($)"
                : "Opening Balance ($)"}
            </Label>
            <CurrencyInput
              id="acc-balance"
              name="openingBalance"
              cents={openingBalanceCents}
              onCentsChange={setOpeningBalanceCents}
              allowNegative
              className="h-9"
            />
            {(type === "credit" || type === "liability") && (
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
      </Modal>
    </>
  );
}
