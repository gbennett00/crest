"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { assignCategory } from "@/app/(app)/budget/actions";
import { paymentShortfallCents } from "@/lib/budget/compute";
import type { BudgetCategory } from "@/lib/budget/types";

/** Format with an explicit + on positive amounts (matches the YNAB breakdown). */
function formatSigned(cents: number): string {
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

function LineItem({
  label,
  cents,
  bold = false,
  divider = false,
}: {
  label: string;
  cents: number;
  bold?: boolean;
  divider?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3",
        divider && "border-t pt-1.5 mt-1",
      )}
    >
      <span className={cn("text-muted-foreground", bold && "font-semibold text-foreground")}>
        {label}
      </span>
      <span className={cn("tabular-nums", bold && "font-semibold")}>
        {formatSigned(cents)}
      </span>
    </div>
  );
}

/**
 * Activity cell for a credit-card payment category. Unlike a normal category,
 * a payment category has no directly-allocated transactions to link to, so the
 * activity amount instead opens a YNAB-style breakdown popover with a one-click
 * "assign to cover" action when the payment envelope is underfunded. The amount
 * turns amber while underfunded so the funding gap is visible at a glance.
 */
export function PaymentCategoryActivity({
  cat,
  month,
}: {
  cat: BudgetCategory;
  month: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const shortfall = paymentShortfallCents(cat.availableCents, cat.cardRegisterBalanceCents);
  const underfunded = shortfall > 0;
  const breakdown = cat.cardActivityBreakdown;

  function handleCover() {
    startTransition(async () => {
      await assignCategory(cat.id, month, cat.assignedCents + shortfall);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <span className="relative inline-block text-right">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "tabular-nums hover:underline",
          underfunded ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        )}
      >
        {formatCents(cat.activityCents)}
      </button>

      {open && (
        <>
          {/* Click-away backdrop */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 bottom-7 z-50 w-80 bg-background border rounded-lg shadow-lg p-3 space-y-3 text-left">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Activity
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={13} />
              </button>
            </div>

            {breakdown ? (
              <div className="flex gap-4 text-xs">
                <div className="flex-1 space-y-1">
                  <LineItem label="Spending" cents={breakdown.spendingCents} />
                  <LineItem label="Returns" cents={breakdown.returnsCents} />
                  <LineItem
                    label="Total Spending"
                    cents={breakdown.totalSpendingCents}
                    bold
                    divider
                  />
                </div>
                <div className="flex-1 space-y-1 border-l pl-4">
                  <LineItem label="Funded Spending" cents={breakdown.fundedSpendingCents} />
                  <LineItem
                    label="Payments & Returns"
                    cents={breakdown.paymentsAndReturnsCents}
                  />
                  <LineItem
                    label="Total Activity"
                    cents={breakdown.totalActivityCents}
                    bold
                    divider
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No activity this month.</p>
            )}

            {underfunded && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-2 space-y-2">
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {`${formatCents(shortfall)} of card spending isn't covered — assign more to fully fund this payment.`}
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 w-full text-xs"
                  disabled={isPending}
                  onClick={handleCover}
                >
                  {isPending ? "…" : `Assign ${formatCents(shortfall)} to cover`}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </span>
  );
}
