"use client";

import * as React from "react";
import { CurrencyInput } from "@/components/ui/currency-input";
import { MONEY_KEYPAD_ATTR, MoneyKeypad } from "@/components/ui/money-keypad";
import {
  type AssignmentKey,
  formatCentsInput,
  initialAssignmentEditState,
  pressAssignmentKey,
  resolveAssignmentEditState,
  setAssignmentCents,
} from "@/lib/currency-input";
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

const subscribeCoarsePointer = (cb: () => void) => {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const isCoarsePointer = () => window.matchMedia("(pointer: coarse)").matches;

/**
 * The editing UI behind an assignable amount (category/group "Assigned"
 * cells, and the cover-overspending source rows), always auto-focused for the
 * duration of one edit.
 *
 * Editing starts prefilled with the current value, same as any other
 * digit-shift money field (see CurrencyInput) — typing digits shifts them
 * in from the right, Backspace clears them from the right. Pressing "+" or
 * "-" instead switches into delta mode: the original amount reappears above
 * (dimmed, un-editable) and a signed delta — built from a blank slate, the
 * same digit-shift way — accumulates below; the committed value becomes
 * `original + delta`.
 *
 * On touch devices the native keyboard (no minus key) is replaced by an
 * on-screen MoneyKeypad, and the amount is a plain display rather than a
 * focused input; the edit commits on Done or a tap outside the editor. On
 * desktop the physical keyboard drives a CurrencyInput and the edit commits
 * on blur/Enter. The key rules live in lib/currency-input.ts.
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
  const [state, setState] = React.useState(() => initialAssignmentEditState(original));
  const useKeypad = React.useSyncExternalStore(
    subscribeCoarsePointer,
    isCoarsePointer,
    () => false,
  );
  const rootRef = React.useRef<HTMLDivElement>(null);

  function commit() {
    const resolved = resolveAssignmentEditState(state);
    if (resolved === null) {
      onCancel();
      return;
    }
    onCommit(resolved);
  }

  // The document listener below must always call the latest commit().
  const commitRef = React.useRef(commit);
  commitRef.current = commit;

  // Keypad mode has no input to blur, so a tap elsewhere ends the edit.
  React.useEffect(() => {
    if (!useKeypad) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      if (rootRef.current?.contains(target)) return;
      if (target?.closest(`[${MONEY_KEYPAD_ATTR}]`)) return;
      commitRef.current();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [useKeypad]);

  // Keep the edited row visible above the keypad.
  React.useEffect(() => {
    if (useKeypad) rootRef.current?.scrollIntoView({ block: "center" });
  }, [useKeypad]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "+" || e.key === "-") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setState((s) => pressAssignmentKey(s, e.key as AssignmentKey));
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

  const isDelta = state.mode === "delta";
  const signedAbsolute = state.absoluteSign * state.absoluteCents;

  // Keypad mode shows the value as text with a caret; desktop uses a real input.
  function amountField() {
    if (useKeypad) {
      return (
        <span className="flex flex-1 min-w-0 items-center justify-end tabular-nums">
          <span className="truncate">
            {formatCentsInput(isDelta ? state.deltaCents : state.absoluteCents)}
          </span>
          <span className="ml-px h-[1.1em] w-px animate-pulse bg-current" />
        </span>
      );
    }
    return (
      <CurrencyInput
        autoFocus
        cents={isDelta ? state.deltaCents : signedAbsolute}
        onCentsChange={(c) => setState((s) => setAssignmentCents(s, c))}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        className={cn(flushInputClass, isDelta && "text-primary")}
      />
    );
  }

  const keypad = useKeypad ? (
    <MoneyKeypad
      onKey={(key) => setState((s) => pressAssignmentKey(s, key))}
      onDone={commit}
    />
  ) : null;

  // One stable root for both modes so the keypad isn't remounted on +/-.
  return (
    <div
      ref={rootRef}
      className={cn(
        "rounded-md border border-input bg-background px-2 py-1",
        "animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none",
        isDelta ? "flex flex-col items-end leading-tight" : "flex items-center gap-0.5",
        className,
        // The two-line delta layout needs more room than the cells' fixed
        // single-line height (e.g. AssignedInput's h-7 py-0).
        isDelta && "h-auto min-h-7 py-1",
      )}
    >
      {isDelta ? (
        <>
          <span className="text-xs text-muted-foreground tabular-nums animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none">
            {formatCents(state.base)}
          </span>
          <div className="flex items-center gap-0.5 text-primary">
            <span className="text-xs">{state.deltaSign === 1 ? "+" : "-"}</span>
            {showDollarSign && <span className="text-xs">$</span>}
            {amountField()}
          </div>
        </>
      ) : (
        <>
          {state.absoluteSign === -1 && <span className="text-xs">-</span>}
          {showDollarSign && <span className="text-muted-foreground text-xs">$</span>}
          {amountField()}
        </>
      )}
      {keypad}
    </div>
  );
}
