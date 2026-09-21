"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { useFormattedCents } from "@/components/money";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import {
  reconcileMatched,
  reconcileWithAdjustmentAction,
} from "@/app/(app)/accounts/actions";
import { reconcileInitialView } from "@/lib/ledger";
import { cn } from "@/lib/utils";
import { CheckCircle2, X } from "lucide-react";

// "matched"/"review" are the linked-account paths that use the bank-reported
// balance to decide up front; "confirm" is the manual (unlinked) ask.
type Step = "matched" | "review" | "confirm" | "adjust" | "success";

export function ReconcileDialog({
  accountId,
  registerClearedBalanceCents,
  isLinked = false,
  bankBalanceCents = null,
  onClose,
}: {
  accountId: string;
  registerClearedBalanceCents: number;
  isLinked?: boolean;
  /** Last bank-reported cleared balance (accounts.balance_cents), for linked accounts. */
  bankBalanceCents?: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const formatCents = useFormattedCents();

  // A linked account has an authoritative bank balance to compare against, so we
  // can tell the user up front whether their cleared register already matches —
  // YNAB-style — instead of asking them to eyeball it against their bank app.
  // Pending/uncleared transactions are intentionally ignored: reconciliation is
  // about the *cleared* balance only.
  const hasBankBalance = isLinked && bankBalanceCents !== null;
  const initialView = reconcileInitialView(
    isLinked,
    bankBalanceCents,
    registerClearedBalanceCents,
  );
  // "manual" maps to the confirm step; matched/review are their own steps.
  const initialStep: Step = initialView === "manual" ? "confirm" : initialView;

  const [step, setStep] = useState<Step>(initialStep);
  const [actualCents, setActualCents] = useState(
    hasBankBalance ? bankBalanceCents! : registerClearedBalanceCents,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const differenceCents = actualCents - registerClearedBalanceCents;
  // Signed gap between the bank's balance and the cleared register (review step).
  const bankDifferenceCents = hasBankBalance
    ? bankBalanceCents! - registerClearedBalanceCents
    : 0;

  // "The cleared register is correct": snap balance_cents to it and mark reconciled.
  function handleMarkReconciled() {
    setError(null);
    startTransition(async () => {
      const result = await reconcileMatched(accountId);
      if (result.error) {
        setError(result.error);
      } else {
        setStep("success");
        invalidateAllLedgerQueries(queryClient);
        router.refresh();
      }
    });
  }

  // Reconcile to a specific actual cleared balance, writing an adjustment for any gap.
  function reconcileToActual(cents: number) {
    setError(null);
    startTransition(async () => {
      const result = await reconcileWithAdjustmentAction(accountId, cents);
      if (result.error) {
        setError(result.error);
      } else {
        setStep("success");
        invalidateAllLedgerQueries(queryClient);
        router.refresh();
      }
    });
  }

  function handleCreateAdjustment() {
    reconcileToActual(actualCents);
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

        {/* Step: linked account whose bank balance already matches the cleared register */}
        {step === "matched" && (
          <div className="px-5 pb-5 space-y-4">
            <div className="rounded-lg bg-green-500/10 p-4 text-center space-y-2">
              <CheckCircle2 size={32} className="text-green-500 mx-auto" />
              <p className="text-sm font-medium">
                Your cleared balance matches your bank
              </p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatCents(registerClearedBalanceCents)}
              </p>
            </div>
            <p className="text-sm text-muted-foreground leading-snug">
              Everything lines up — nothing to adjust. Mark the cleared
              transactions as reconciled?
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="space-y-2">
              <Button className="w-full" onClick={handleMarkReconciled} disabled={isPending}>
                {isPending ? "Reconciling…" : "Mark reconciled"}
              </Button>
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => {
                  setError(null);
                  setStep("adjust");
                }}
                disabled={isPending}
              >
                Balance is off — enter it manually
              </Button>
            </div>
          </div>
        )}

        {/* Step: linked account whose bank balance disagrees with the cleared register */}
        {step === "review" && (
          <div className="px-5 pb-5 space-y-4">
            <div className="rounded-lg bg-muted/40 p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Cleared in Crest</span>
                <span className="font-semibold tabular-nums">
                  {formatCents(registerClearedBalanceCents)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Your bank reports</span>
                <span className="font-semibold tabular-nums">
                  {formatCents(bankBalanceCents!)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t pt-2">
                <span className="text-muted-foreground">Difference</span>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    bankDifferenceCents < 0
                      ? "text-destructive"
                      : "text-green-600 dark:text-green-400",
                  )}
                >
                  {bankDifferenceCents > 0 ? "+" : ""}
                  {formatCents(bankDifferenceCents)}
                </span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-snug">
              Your bank balance doesn&apos;t match your cleared register. Create an
              adjustment for the difference, or check for missing or duplicate
              cleared transactions first.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={() => reconcileToActual(bankBalanceCents!)}
                disabled={isPending}
              >
                {isPending ? "Reconciling…" : "Create adjustment & reconcile"}
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
                Enter a different balance
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

        {/* Step: Confirm the calculated balance (manual / unlinked accounts) */}
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
                onClick={handleMarkReconciled}
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
                <CurrencyInput
                  cents={actualCents}
                  onCentsChange={setActualCents}
                  allowNegative
                  className={cn(
                    // text-base on mobile (16px) stops iOS from zooming on focus.
                    "w-full rounded-md border border-input bg-background pl-7 pr-3 py-2 text-base md:text-sm",
                    "focus:outline-none focus:ring-1 focus:ring-ring",
                  )}
                />
              </div>
            </div>
            {differenceCents !== 0 && (
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
            {differenceCents === 0 && (
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
                  setStep(initialStep);
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
