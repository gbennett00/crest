"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormattedCents } from "@/components/money";
import { previousBudgetMonth } from "@/lib/ledger";
import type { BudgetData } from "./budget-screen";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMonth(month: string) {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * Read-only decomposition of Ready to Assign for the viewed month — a YNAB-style
 * "where did this number come from" card. Every line comes from
 * `data.rtaBreakdown` and the lines sum to the total shown at the bottom.
 */
export function RtaBreakdownPopup({
  data,
  onClose,
}: {
  data: BudgetData;
  onClose: () => void;
}) {
  const formatCents = useFormattedCents();
  const b = data.rtaBreakdown;
  const prevMonth = previousBudgetMonth(data.month);

  // Additions (money into the pool) and subtractions (money committed out of
  // it). A negative leftover is a prior over-commitment, so it reads as a
  // subtraction; only list lines that carry a value.
  const additions = [
    {
      label: `Left over from ${formatMonth(prevMonth)}`,
      cents: b.leftoverFromPriorCents,
      show: b.leftoverFromPriorCents >= 0,
    },
    {
      label: `Inflow: Ready to Assign in ${formatMonth(data.month)}`,
      cents: b.inflowThisMonthCents,
      show: b.inflowThisMonthCents !== 0,
    },
  ].filter((l) => l.show);

  const subtractions = [
    {
      label: `Over-committed from ${formatMonth(prevMonth)}`,
      cents: b.leftoverFromPriorCents,
      show: b.leftoverFromPriorCents < 0,
    },
    {
      label: `Assigned in ${formatMonth(data.month)}`,
      cents: -b.assignedThisMonthCents,
      show: b.assignedThisMonthCents !== 0,
    },
    {
      label: `Cash overspending in ${formatMonth(prevMonth)}`,
      cents: -b.previousMonthCashOverspendCents,
      show: b.previousMonthCashOverspendCents !== 0,
    },
    {
      label: "Assigned in future months",
      cents: -b.assignedFutureCents,
      show: b.assignedFutureCents !== 0,
    },
  ].filter((l) => l.show);

  const additionsTotal = additions.reduce((s, l) => s + l.cents, 0);
  const subtractionsTotal = subtractions.reduce((s, l) => s + l.cents, 0);
  const overAssigned = b.totalCents < 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-background w-full sm:max-w-md sm:rounded-2xl flex flex-col max-h-[92dvh] sm:max-h-[85dvh] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold text-base">Ready to Assign breakdown</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Lines */}
        <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4">
          {additions.length > 0 && (
            <Section
              lines={additions}
              subtotal={additionsTotal}
              subtotalTone="add"
            />
          )}
          {subtractions.length > 0 && (
            <Section
              lines={subtractions}
              subtotal={subtractionsTotal}
              subtotalTone="subtract"
            />
          )}

          {/* Total */}
          <div className="flex items-center justify-between pt-3 mt-1 border-t">
            <span className="font-semibold text-sm">Total Ready to Assign</span>
            <span
              className={cn(
                "font-bold text-base tabular-nums",
                overAssigned ? "text-destructive" : "text-primary",
              )}
            >
              {formatCents(b.totalCents)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {overAssigned
              ? "You've assigned more than you have. Reduce an assignment to get back to $0."
              : b.totalCents === 0
                ? "Nice work — every dollar has a job."
                : "This is money that hasn't been assigned to a category yet."}
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({
  lines,
  subtotal,
  subtotalTone,
}: {
  lines: { label: string; cents: number }[];
  subtotal: number;
  subtotalTone: "add" | "subtract";
}) {
  const formatCents = useFormattedCents();
  return (
    <div className="mb-4 last:mb-3">
      {lines.map((line) => (
        <div
          key={line.label}
          className="flex items-start justify-between gap-4 py-1.5"
        >
          <span className="text-sm text-muted-foreground">{line.label}</span>
          <span
            className={cn(
              "text-sm tabular-nums shrink-0",
              subtotalTone === "add"
                ? "text-green-600 dark:text-green-400"
                : "text-foreground",
            )}
          >
            {formatCents(line.cents)}
          </span>
        </div>
      ))}
      {lines.length > 1 && (
        <div className="flex items-center justify-between gap-4 pt-1.5 mt-1 border-t border-dashed">
          <span className="text-xs font-medium text-muted-foreground">
            {subtotalTone === "add" ? "Total added" : "Total assigned"}
          </span>
          <span
            className={cn(
              "text-xs font-semibold tabular-nums",
              subtotalTone === "add"
                ? "text-green-600 dark:text-green-400"
                : "text-foreground",
            )}
          >
            {formatCents(subtotal)}
          </span>
        </div>
      )}
    </div>
  );
}
