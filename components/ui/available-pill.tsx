"use client";

import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { useFormattedCents } from "@/components/money";
import { amountFontSize } from "@/lib/amount-size";
import { availablePillState, type PillState } from "@/lib/available-pill";

const pillVariants = cva(
  "num inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-pill px-2.5 py-1 text-pill",
  {
    variants: {
      state: {
        pos: "bg-pos-bg text-pos-ink",
        warn: "bg-warn-bg text-warn-ink",
        neg: "bg-neg-bg text-neg-ink",
        zero: "bg-zero-bg text-zero-ink",
      },
    },
    defaultVariants: { state: "pos" },
  },
);

export interface AvailablePillProps extends React.HTMLAttributes<HTMLSpanElement> {
  cents: number;
  /** Defaults to the state implied by `cents`; pass "warn" for needs-attention. */
  state?: PillState;
}

/**
 * Money left in a category or account. State is never conveyed by colour
 * alone: negatives carry their minus sign (from formatCents) and warnings a
 * leading "!".
 */
export function AvailablePill({ cents, state, className, style, ...props }: AvailablePillProps) {
  const formatCents = useFormattedCents();
  const resolved = state ?? availablePillState(cents);
  const text = formatCents(cents);
  return (
    <span
      className={cn(pillVariants({ state: resolved }), className)}
      // Smaller as the figure gets longer, so it stays inside its column.
      style={{ fontSize: amountFontSize(text, 13), ...style }}
      {...props}
    >
      {resolved === "warn" && <span aria-hidden="true">!</span>}
      {text}
    </span>
  );
}
