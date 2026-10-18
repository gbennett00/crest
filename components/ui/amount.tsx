"use client";

import { cn } from "@/lib/utils";
import { amountFontSize } from "@/lib/amount-size";
import { useFormattedCents } from "@/components/money";

/**
 * A currency figure for a fixed-width column: tabular, never wrapping, and
 * drawn smaller as it gets longer (see lib/amount-size.ts). The size is set
 * inline, so it overrides any type-scale class (which still supplies weight
 * and line height).
 */
export function Amount({
  cents,
  basePx = 14,
  className,
}: {
  cents: number;
  /** Size in px for figures up to "$1,500.00". */
  basePx?: number;
  className?: string;
}) {
  const formatCents = useFormattedCents();
  const text = formatCents(cents);
  return (
    <span
      className={cn("num whitespace-nowrap", className)}
      style={{ fontSize: amountFontSize(text, basePx) }}
    >
      {text}
    </span>
  );
}
