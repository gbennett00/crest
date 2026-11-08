"use client";

import * as React from "react";
import { Check, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Money } from "@/components/money";

export type TransactionRowProps = {
  payee: string;
  /** Caption under the payee, e.g. "Oct 3 · Venture – 2562". */
  meta: string;
  amountCents: number;
  /** Category name (or "Split (n)"); null shows "Uncategorized". */
  category: string | null;
  /** Marks a category that was filled in automatically. */
  suggested?: boolean;
  /** Needs approval: draws the warn status dot (when not selecting). */
  pending?: boolean;
  /** Selection mode: a checkbox replaces the dot. */
  selecting?: boolean;
  selected?: boolean;
  onClick?: () => void;
  /** Warm caches on intent (hover, focus, press). */
  onIntent?: () => void;
  className?: string;
};

/**
 * The list item for Review, Transactions and every account (design system
 * TransactionRow). Left: status dot, or a checkbox while selecting. Middle:
 * payee over date and account. Right: signed amount over the category. The
 * whole row is one button.
 */
export function TransactionRow({
  payee,
  meta,
  amountCents,
  category,
  suggested,
  pending,
  selecting,
  selected,
  onClick,
  onIntent,
  className,
}: TransactionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onIntent}
      onFocus={onIntent}
      onPointerDown={onIntent}
      aria-pressed={selecting ? !!selected : undefined}
      className={cn(
        "flex min-h-row-list w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
        selected ? "bg-brand-subtle" : "hover:bg-surface-raised",
        className,
      )}
    >
      {selecting ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-ds-sm border-2",
            selected ? "border-brand bg-brand text-brand-ink" : "border-border-strong",
          )}
        >
          {selected && <Check size={16} strokeWidth={3} />}
        </span>
      ) : (
        pending && (
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill bg-warn-ink" />
        )
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-strong text-ink">{payee}</span>
        <span className="block truncate text-caption text-ink-muted">{meta}</span>
      </span>

      <span className="flex max-w-[45%] shrink-0 flex-col items-end">
        <span
          className={cn(
            "num text-amount",
            amountCents < 0 ? "text-neg-text" : "text-pos-text",
          )}
        >
          <Money cents={amountCents} sign />
        </span>
        <span className="flex min-w-0 max-w-full items-center gap-1.5 text-caption">
          {suggested && category && (
            <span title="Suggested automatically — approve to keep it" className="flex shrink-0 text-brand-text">
              <Sparkles size={13} strokeWidth={2} aria-hidden />
              <span className="sr-only">Suggested:</span>
            </span>
          )}
          <span className={cn("truncate", category ? "text-ink-muted" : "text-ink-subtle")}>
            {category ?? "Uncategorized"}
          </span>
        </span>
      </span>
    </button>
  );
}
