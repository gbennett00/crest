"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/format";
import { reconcileAccount, updateStatementBalance } from "@/app/(app)/accounts/actions";
import { cn } from "@/lib/utils";
import { CheckCircle2, X } from "lucide-react";

type Step = "confirm" | "update-balance" | "success";

export function ReconcileDialog({
  accountId,
  registerClearedBalanceCents,
  bankClearedBalanceCents,
  onClose,
}: {
  accountId: string;
  registerClearedBalanceCents: number;
  bankClearedBalanceCents: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("confirm");
  const [balanceInput, setBalanceInput] = useState(
    (Math.abs(bankClearedBalanceCents) / 100).toFixed(2),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleYes() {
    setError(null);
    startTransition(async () => {
      const result = await reconcileAccount(accountId);
      if (result.error) {
        setError(result.error);
      } else {
        setStep("success");
        router.refresh();
      }
    });
  }

  function handleUpdateBalance() {
    const cents = Math.round(parseFloat(balanceInput) * 100);
    if (isNaN(cents) || cents < 0) {
      setError("Enter a valid balance");
      return;
    }
    setError(null);
    startTransition(async () => {
      const updateResult = await updateStatementBalance(accountId, cents);
      if (updateResult.error) {
        setError(updateResult.error);
        return;
      }
      // After updating balance, attempt to reconcile
      const reconcileResult = await reconcileAccount(accountId);
      if (reconcileResult.error) {
        setError(reconcileResult.error);
      } else {
        setStep("success");
        router.refresh();
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-background rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-semibold text-base">
            {step === "success" ? "Reconciled!" : "Reconcile Account"}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Step: Confirm */}
        {step === "confirm" && (
          <div className="px-5 pb-5 space-y-4">
            <div className="rounded-lg bg-muted/40 p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Cleared in Crest</span>
                <span className="font-semibold tabular-nums">
                  {formatCents(registerClearedBalanceCents)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Statement balance</span>
                <span className="font-semibold tabular-nums">
                  {formatCents(bankClearedBalanceCents)}
                </span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-snug">
              Does your cleared balance of{" "}
              <strong className="text-foreground">
                {formatCents(registerClearedBalanceCents)}
              </strong>{" "}
              match what your bank shows?
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleYes}
                disabled={isPending}
              >
                {isPending ? "Reconciling…" : "Yes, they match"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { setError(null); setStep("update-balance"); }}
                disabled={isPending}
              >
                No, update balance
              </Button>
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={onClose}
                disabled={isPending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Step: Update bank balance */}
        {step === "update-balance" && (
          <div className="px-5 pb-5 space-y-4">
            <p className="text-sm text-muted-foreground leading-snug">
              Enter the cleared balance shown in your bank app.
            </p>
            <div className="rounded-lg bg-muted/40 p-4">
              <p className="text-xs text-muted-foreground mb-1">Crest cleared</p>
              <p className="font-semibold tabular-nums text-sm">
                {formatCents(registerClearedBalanceCents)}
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Bank balance</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(e.target.value)}
                  className={cn(
                    "w-full rounded-md border border-input bg-background pl-7 pr-3 py-2 text-sm",
                    "focus:outline-none focus:ring-1 focus:ring-ring",
                  )}
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleUpdateBalance}
                disabled={isPending}
              >
                {isPending ? "Saving…" : "Update & Reconcile"}
              </Button>
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => { setError(null); setStep("confirm"); }}
                disabled={isPending}
              >
                Back
              </Button>
            </div>
          </div>
        )}

        {/* Step: Success */}
        {step === "success" && (
          <div className="px-5 pb-5 space-y-4 text-center">
            <div className="flex justify-center">
              <CheckCircle2 size={48} className="text-green-500" />
            </div>
            <p className="text-sm text-muted-foreground">
              All cleared transactions have been marked as reconciled.
            </p>
            <Button className="w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
