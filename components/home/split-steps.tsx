"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Check, X } from "lucide-react";

import { CurrencyInput } from "@/components/ui/currency-input";
import { useCoarsePointer } from "@/components/ui/money-keypad";
import { useFormattedCents } from "@/components/money";
import { CategoryList, CategorySearchField } from "@/components/transactions/category-list";
import type { CategoryOption } from "@/components/transactions/transaction-form";
import { cn } from "@/lib/utils";
import { splitLeadingEmoji } from "@/lib/leading-emoji";
import { amountUsingRemaining, splitRemaining, type SplitLine } from "@/lib/budget/split";

/**
 * Split step 1 (YNAB-style): choose the categories to split between. A search
 * field over the same grouped list as the drawer's browse mode, with
 * checkboxes; picks show as chips above the list (tap one to drop it). The
 * drawer's footer holds Next.
 */
export function SplitCategoryPicker({
  categories,
  byId,
  chosenIds,
  onToggle,
  suggestedIds,
}: {
  categories: CategoryOption[];
  byId: Map<string, CategoryOption>;
  chosenIds: string[];
  onToggle: (categoryId: string) => void;
  suggestedIds: string[];
}) {
  const [query, setQuery] = useState("");
  const chosen = new Set(chosenIds);

  return (
    <>
      <CategorySearchField value={query} onChange={setQuery} className="shrink-0" />

      {chosenIds.length > 0 && (
        <ul className="-mx-5 mt-2.5 flex shrink-0 gap-2 overflow-x-auto px-5 pb-1" aria-label="Chosen categories">
          {chosenIds.map((id) => {
            const name = byId.get(id)?.name ?? "Unknown";
            return (
              <li key={id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onToggle(id)}
                  aria-label={`Remove ${name}`}
                  className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-pill bg-brand-subtle pl-2.5 pr-2 text-[14px] font-semibold text-brand-text"
                >
                  {name}
                  <X size={14} strokeWidth={2.25} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="-mx-5 mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain border-t">
        <CategoryList
          categories={categories}
          value={null}
          selectedIds={chosen}
          onSelect={onToggle}
          query={query}
          suggestedIds={suggestedIds}
        />
      </div>
    </>
  );
}

/**
 * Split step 2: one amount per chosen category, with what's left at the top.
 * On touch devices each amount opens the Crest keypad: its "Use remaining"
 * chip sets that line so nothing is left over, and its primary key reads
 * Next until the last line. With a physical keyboard, Enter moves on and a
 * "Use remaining" button sits next to each amount it would change.
 */
export function SplitAmounts({
  lines,
  totalAbsCents,
  byId,
  onChange,
  onChangeCategories,
}: {
  lines: SplitLine[];
  totalAbsCents: number;
  byId: Map<string, CategoryOption>;
  onChange: (index: number, amountCents: number) => void;
  onChangeCategories: () => void;
}) {
  const formatCents = useFormattedCents();
  const coarse = useCoarsePointer();
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const remaining = splitRemaining(totalAbsCents, lines);
  const assigned = totalAbsCents - remaining;

  // Start on the first line still at $0.00 (keypad open on touch). Lines
  // already filled in (an existing split) are left alone.
  useEffect(() => {
    const first = lines.findIndex((l) => l.amountCents === 0);
    if (first >= 0) inputs.current[first]?.focus();
    // Only when the step opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function moveOn(index: number) {
    const next = inputs.current[index + 1];
    if (next) next.focus();
    else inputs.current[index]?.blur();
  }

  function fillRemaining(index: number) {
    onChange(index, amountUsingRemaining(totalAbsCents, lines, index));
  }

  return (
    <>
      <div
        className="flex items-center gap-2.5 rounded-ds-md border bg-surface-sunken px-3.5 py-3"
        aria-live="polite"
      >
        {remaining === 0 ? (
          <span className="num inline-flex h-7 items-center gap-1 rounded-pill bg-pos-bg px-2.5 text-pill text-pos-ink">
            <Check size={14} strokeWidth={2.5} aria-hidden />
            Fully split
          </span>
        ) : (
          <span
            className={cn(
              "num inline-flex h-7 items-center rounded-pill px-2.5 text-pill",
              remaining > 0 ? "bg-warn-bg text-warn-ink" : "bg-neg-bg text-neg-ink",
            )}
          >
            {remaining > 0
              ? `${formatCents(remaining)} left`
              : `${formatCents(-remaining)} over`}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-caption text-ink-muted">
          {remaining === 0
            ? `${formatCents(totalAbsCents)} across ${lines.length} categories`
            : `Split ${formatCents(assigned)} of ${formatCents(totalAbsCents)}`}
        </span>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {lines.map((line, index) => {
          const name = byId.get(line.categoryId)?.name ?? "Unknown";
          const { emoji, label } = splitLeadingEmoji(name);
          // What "Use remaining" would set this line to; offered only when it changes it.
          const filled = amountUsingRemaining(totalAbsCents, lines, index);
          const canFill = filled !== line.amountCents;
          const isLast = index === lines.length - 1;
          return (
            <li
              key={line.categoryId}
              className="flex min-h-14 items-center gap-3 rounded-ds-md border bg-surface py-1.5 pl-3 pr-1.5"
            >
              {emoji && (
                <span aria-hidden="true" className="w-[26px] shrink-0 text-center text-xl">
                  {emoji}
                </span>
              )}
              <label
                htmlFor={`split-amount-${index}`}
                className="min-w-0 flex-1 truncate text-body font-medium text-ink"
              >
                {label}
              </label>
              {/* Always rendered while it would change the line (not only while
                  the amount is focused), so it can be reached with Tab. */}
              {!coarse && canFill && (
                <button
                  type="button"
                  // Keep focus in the amount while clicking.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => fillRemaining(index)}
                  aria-label={`Use remaining for ${label}: ${formatCents(filled)}`}
                  className="shrink-0 rounded-ds-sm px-2 py-1 text-caption font-semibold text-brand-text hover:bg-surface-sunken"
                >
                  Use remaining
                </button>
              )}
              <div className="relative w-32 shrink-0">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-body font-semibold text-ink-subtle"
                >
                  $
                </span>
                <CurrencyInput
                  id={`split-amount-${index}`}
                  ref={(el) => {
                    inputs.current[index] = el;
                  }}
                  cents={line.amountCents}
                  onCentsChange={(cents) => onChange(index, cents)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      moveOn(index);
                    }
                  }}
                  enterKeyHint={isLast ? "done" : "next"}
                  keypadDoneLabel={isLast ? "Done" : "Next"}
                  onKeypadDone={() => moveOn(index)}
                  keypadQuickActions={
                    canFill
                      ? [
                          {
                            // The amount the line will take, which is
                            // what's left only when the line is still empty.
                            label: `Use remaining · ${formatCents(filled)}`,
                            icon: <ArrowDownToLine className="text-brand-text" />,
                            onSelect: () => fillRemaining(index),
                          },
                        ]
                      : undefined
                  }
                  className={cn(
                    "num h-11 rounded-ds-sm border-border-strong bg-surface-sunken pl-6 pr-3 text-right text-[17px] font-semibold text-ink md:text-[17px]",
                    "focus-visible:border-brand-text focus-visible:ring-0",
                    line.amountCents === 0 && "text-ink-subtle",
                  )}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex justify-center">
        <button
          type="button"
          onClick={onChangeCategories}
          className="inline-flex h-tap items-center rounded-ds-md px-3 text-body-strong text-brand-text hover:bg-surface"
        >
          Change categories
        </button>
      </div>
    </>
  );
}
