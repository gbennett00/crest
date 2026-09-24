"use client";

import * as React from "react";
import { CurrencyInput } from "@/components/ui/currency-input";
import { resolveAssignmentCommit } from "@/lib/currency-input";
import { cn } from "@/lib/utils";

export interface AssignmentAmountEditorProps {
  /** The value being edited from. Shown (dimmed) above the delta line once
   * the user switches into +/- mode, and the base the delta applies to on
   * commit — never itself typed into directly. */
  original: number;
  onCommit: (cents: number) => void;
  onCancel: () => void;
  /** Privacy-mode-aware formatter, for the dimmed original-amount line. */
  formatCents: (cents: number) => string;
  /** Sizing/border classes for the editor's outer box (both modes). */
  className?: string;
  /** Shows a "$" before the digits — assign-popup/cover-overspending's rows
   * have one, assigned-input's plain table cell doesn't. */
  showDollarSign?: boolean;
}

const flushInputClass =
  "h-auto flex-1 min-w-0 border-0 bg-transparent p-0 shadow-none text-right tabular-nums focus-visible:ring-0";

/**
 * The editing UI behind an assignable amount (category/group "Assigned"
 * cells, and the cover-overspending source rows) — a YNAB-style keypad
 * entry, always auto-focused for the duration of one edit.
 *
 * Editing starts prefilled with the current value, same as any other
 * digit-shift money field (see CurrencyInput) — typing digits shifts them
 * in from the right, Backspace clears them from the right. Pressing "+" or
 * "-" instead switches into delta mode: the original amount reappears above
 * (dimmed, un-editable) and a signed delta — built from a blank slate, the
 * same digit-shift way — accumulates below; the committed value becomes
 * `original + delta`.
 *
 * Nothing commits until the user actually types something (`touched`) —
 * focusing and blurring without a keystroke leaves the original value
 * alone, same as clicking away from a no-op edit anywhere else.
 */
export function AssignmentAmountEditor({
  original,
  onCommit,
  onCancel,
  formatCents,
  className,
  showDollarSign = false,
}: AssignmentAmountEditorProps) {
  const [mode, setMode] = React.useState<"absolute" | "delta">("absolute");
  const [absoluteCents, setAbsoluteCents] = React.useState(original);
  const [deltaSign, setDeltaSign] = React.useState<1 | -1>(1);
  const [deltaCents, setDeltaCents] = React.useState(0);
  const [touched, setTouched] = React.useState(false);

  function commit() {
    const resolved = resolveAssignmentCommit({
      touched,
      mode,
      original,
      absoluteCents,
      deltaSign,
      deltaCents,
    });
    if (resolved === null) {
      onCancel();
      return;
    }
    onCommit(resolved);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "+" || e.key === "-") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const pressedSign: 1 | -1 = e.key === "+" ? 1 : -1;
      setTouched(true);
      if (mode === "absolute") {
        setMode("delta");
        setDeltaSign(pressedSign);
        setDeltaCents(0);
      } else {
        setDeltaSign(pressedSign);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === "Escape") {
      onCancel();
    }
  }

  if (mode === "delta") {
    return (
      <div
        className={cn(
          "flex flex-col items-end rounded-md border border-input bg-background px-2 py-1 leading-tight",
          className,
        )}
      >
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatCents(original)}
        </span>
        <div className="flex items-center gap-0.5 text-primary">
          <span className="text-xs">{deltaSign === 1 ? "+" : "-"}</span>
          {showDollarSign && <span className="text-xs">$</span>}
          <CurrencyInput
            autoFocus
            cents={deltaCents}
            onCentsChange={(c) => {
              setDeltaCents(c);
              setTouched(true);
            }}
            onKeyDown={handleKeyDown}
            onBlur={commit}
            className={cn(flushInputClass, "text-primary")}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-md border border-input bg-background px-2 py-1",
        className,
      )}
    >
      {showDollarSign && <span className="text-muted-foreground text-xs">$</span>}
      <CurrencyInput
        autoFocus
        cents={absoluteCents}
        onCentsChange={(c) => {
          setAbsoluteCents(c);
          setTouched(true);
        }}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        className={flushInputClass}
      />
    </div>
  );
}
