"use client";

import { useState } from "react";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * YNAB-style account balance header. Leads with the working balance (sum of all
 * register lines, cleared + uncleared) — the figure that updates the instant a
 * transaction is entered. Tapping it reveals the cleared / uncleared split.
 * `balance_cents` (the bank statement balance) is deliberately absent here; it
 * surfaces only in the reconcile flow.
 */
export function AccountBalanceSummary({
  subtitle,
  workingBalanceCents,
  clearedCents,
  unclearedCents,
}: {
  subtitle: string;
  workingBalanceCents: number;
  clearedCents: number;
  unclearedCents: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-4 py-4 border-b bg-muted/20">
      <p className="text-xs text-muted-foreground text-center mb-1">{subtitle}</p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex flex-col items-center w-full"
        aria-expanded={expanded}
      >
        <span className="text-xs text-muted-foreground">Working balance</span>
        <span
          className={cn(
            "text-lg font-semibold tabular-nums",
            workingBalanceCents < 0 && "text-destructive",
          )}
        >
          {formatCents(workingBalanceCents)}
        </span>
      </button>

      {expanded && (
        <div className="flex justify-center gap-6 mt-3">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Cleared</p>
            <p className="text-sm font-semibold tabular-nums">{formatCents(clearedCents)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Uncleared</p>
            <p
              className={cn(
                "text-sm font-semibold tabular-nums",
                unclearedCents < 0 && "text-destructive",
              )}
            >
              {formatCents(unclearedCents)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
