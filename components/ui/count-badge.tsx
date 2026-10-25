import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const countBadgeVariants = cva(
  "num inline-flex min-h-6 items-center justify-center rounded-pill px-2.5 py-0.5 text-pill",
  {
    variants: {
      tone: {
        warn: "bg-warn-bg text-warn-ink",
        neg: "bg-neg-bg text-neg-ink",
        zero: "bg-zero-bg text-zero-ink",
      },
    },
    defaultVariants: { tone: "warn" },
  },
);

/** A small count: "10" new transactions, "3" overspent. */
export function CountBadge({
  tone,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof countBadgeVariants>) {
  return <span className={cn(countBadgeVariants({ tone }), className)} {...props} />;
}
