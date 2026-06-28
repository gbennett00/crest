"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useFormattedCents } from "@/components/money";
import {
  reconcileMatched,
  reconcileWithAdjustmentAction,
} from "@/app/(app)/accounts/actions";
import { cn } from "@/lib/utils";
import { CheckCircle2, X } from "lucide-react";

type Step = "confirm" | "adjust" | "success";

export function ReconcileDialog({
  accountId,
  registerClearedBalanceCents,
  onClose,
}: {
  accountId: string;
  registerClearedBalanceCents: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const formatCents = useFormattedCents();
  const [step, setStep] = useState<Step>("confirm");
  const [actualInput, setActualInput] = useState(
    (registerClearedBalanceCents / 100).toFixed(2),
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Parsed actual cleared balance and how far the register is off, used to drive
  // the adjustment step's messaging and CTA.
  const actualCents = Math.round(parseFloat(actualInput) * 100);
  const actualIsValid = !isNaN(actualCents);
  const differenceCents = actualIsValid
    ? actualCents - registerClearedBalanceCents
    : 0;

  function handleYes() {
    setError(null);
    startTransition(async () => {
      const result = await reconcileMatched(accountId);
      if (result.error) {
        setError(result.error);
      } else {
        setStep("success");
        router.refresh();
      }
    });
  }

  function handleCreateAdjustment() {
    if (!actualIsValid) {
      setError("Enter a valid balance");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await reconcileWithAdjustmentAction(accountId, actualCents);
      if (result.error) {
        setError(result.error);
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

        {/* Step: Confirm the calculated balance */}
        {step === "confirm" && (
          <div className="px-5 pb-5 space-y-4">
            <div className="rounded-lg bg-muted/40 p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">
                Cleared balance in Crest
              </p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatCents(registerClearedBalanceCents)}
              </p>
            </div>
            <p className="text-sm text-muted-foreground leading-snug">
              Does this match the cleared balance shown in your bank app?
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleYes}
                disabled={isPending}
              >
                {isPending ? "Reconciling…" : "Yes, it looks right"}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setError(null);
                  setStep("adjust");
                }}
                disabled={isPending}
              >
                No, it&apos;s off
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

        {/* Step: Enter the actual balance and create an adjustment */}
        {step === "adjust" && (
          <div className="px-5 pb-5 space-y-4">
            <p className="text-sm text-muted-foreground leading-snug">
              Enter the cleared balance shown in your bank app. We&apos;ll add an
              adjustment to make up the difference.
            </p>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Actual cleared balance
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={actualInput}
                  onChange={(e) => setActualInput(e.target.value)}
                  className={cn(
                    "w-full rounded-md border border-input bg-background pl-7 pr-3 py-2 text-sm",
                    "focus:outline-none focus:ring-1 focus:ring-ring",
                  )}
                />
              </div>
            </div>
            {actualIsValid && differenceCents !== 0 && (
              <div className="rounded-lg bg-muted/40 p-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Cleared in Crest</span>
                  <span className="font-semibold tabular-nums">
                    {formatCents(registerClearedBalanceCents)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Adjustment</span>
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      differenceCents < 0
                        ? "text-destructive"
                        : "text-green-600 dark:text-green-400",
                    )}
                  >
                    {differenceCents > 0 ? "+" : ""}
                    {formatCents(differenceCents)}
                  </span>
                </div>
              </div>
            )}
            {actualIsValid && differenceCents === 0 && (
              <p className="text-sm text-muted-foreground">
                That matches the calculated balance — no adjustment needed.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleCreateAdjustment}
                disabled={isPending}
              >
                {isPending
                  ? "Reconciling…"
                  : differenceCents === 0
                    ? "Reconcile"
                    : "Create adjustment & reconcile"}
              </Button>
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => {
                  setError(null);
                  setStep("confirm");
                }}
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
