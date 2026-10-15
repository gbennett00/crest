import * as React from "react";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { Money } from "@/components/money";
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
export function AvailablePill({ cents, state, className, ...props }: AvailablePillProps) {
  const resolved = state ?? availablePillState(cents);
  return (
    <span className={cn(pillVariants({ state: resolved }), className)} {...props}>
      {resolved === "warn" && <span aria-hidden="true">!</span>}
      <Money cents={cents} />
    </span>
  );
}
