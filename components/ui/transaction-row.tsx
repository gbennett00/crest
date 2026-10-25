"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Amount } from "@/components/ui/amount";
import { Checkbox } from "@/components/ui/checkbox";
import { SuggestedTag } from "@/components/transactions/suggested-tag";

type TransactionRowProps = {
  payee: string;
  /** Meta line, e.g. "Oct 3 · G. Bennett – 1227". */
  caption: string;
  /** Signed: negative is an outflow. */
  amountCents: number;
  /** Category name, "Split (n)", or null/undefined when uncategorized. */
  category?: string | null;
  /** The category was filled in automatically and awaits approval. */
  suggested?: boolean;
  /** `dot`: a status dot (needs approval or cleared). `check`: a checkbox. */
  leading?: "dot" | "check";
  /** The status dot: needs approval (warn) or cleared (brand). */
  status?: "pending" | "cleared";
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Row action when `leading` is "dot" (opens the transaction). */
  onPress?: () => void;
  className?: string;
};

/**
 * One transaction in a list (Review, Transactions, an account). Payee and
 * meta on the left; signed amount over its category on the right. In
 * selection mode the whole row toggles its checkbox.
 */
export function TransactionRow({
  payee,
  caption,
  amountCents,
  category,
  suggested,
  leading = "dot",
  status = "pending",
  checked = false,
  onCheckedChange,
  onPress,
  className,
}: TransactionRowProps) {
  const selecting = leading === "check";
  const inflow = amountCents > 0;

  const content = (
    <>
      {selecting ? (
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onCheckedChange?.(v === true)}
          aria-label={`Select ${payee}`}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "mx-2 size-2 shrink-0 rounded-pill",
            status === "pending" ? "bg-warn-ink" : "bg-brand",
          )}
        />
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-body-strong">{payee}</span>
        <span className="block truncate text-caption text-ink-muted">{caption}</span>
      </span>
      <span className="max-w-[150px] shrink-0 text-right">
        <span
          className={cn("block text-amount", inflow ? "text-pos-text" : "text-neg-text")}
        >
          <Amount cents={amountCents} basePx={16} className="text-amount" sign={inflow} />
        </span>
        <span className="flex items-center justify-end gap-1.5 text-caption">
          {category ? (
            <>
              <span className="truncate text-ink-muted">{category}</span>
              {suggested && <SuggestedTag />}
            </>
          ) : (
            <span className="truncate text-ink-subtle">Uncategorized</span>
          )}
        </span>
      </span>
    </>
  );

  const rowClass = cn(
    "flex min-h-row-list w-full items-center gap-3 border-t px-4 py-2 first:border-t-0",
    checked && "bg-brand-subtle",
    className,
  );
  const interactive =
    "text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus";

  // One checkbox, with the whole row as its label, so a tap anywhere on the
  // row toggles it and assistive tech sees a single control.
  if (selecting) {
    return <label className={cn(rowClass, interactive, "cursor-pointer")}>{content}</label>;
  }
  if (onPress) {
    return (
      <button type="button" onClick={onPress} className={cn(rowClass, interactive)}>
        {content}
      </button>
    );
  }
  return <div className={rowClass}>{content}</div>;
}
