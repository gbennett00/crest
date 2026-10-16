"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Delete, Minus, Plus, Equal, CircleX } from "lucide-react";
import type { AssignmentKey } from "@/lib/currency-input";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { usePortalTarget } from "@/components/ui/overlay-container";

/** Marks the keypad so outside-tap handlers can tell it apart from the page. */
export const MONEY_KEYPAD_ATTR = "data-money-keypad";

const subscribeCoarsePointer = (cb: () => void) => {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** True on touch-first devices, where the MoneyKeypad replaces the native keyboard. */
export function useCoarsePointer(): boolean {
  return React.useSyncExternalStore(
    subscribeCoarsePointer,
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

// Bottom padding reserved on the scroll container so the edited field can scroll
// above the pad. The quick-actions row adds its own height.
const KEYPAD_INSET = "20rem";
const KEYPAD_INSET_WITH_ACTIONS = "25rem";

/** The nearest ancestor that scrolls vertically (a modal overlay, say), else the body. */
function scrollParentOf(el: Element | null): HTMLElement {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return document.body;
}

/** A chip above the keys (Move money, Details...) acting on the focused field. */
export type KeypadQuickAction = {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
};

// Plain text keys, no key backgrounds; a pressed key takes the surface tint.
const keyClass =
  "flex h-14 items-center justify-center rounded-ds-sm text-2xl font-medium num select-none touch-manipulation active:bg-surface";

/**
 * An on-screen keypad pinned to the bottom of the viewport: optional quick
 * actions for the focused field, then digits, "-"/"+"/"=" for delta entry,
 * clear, backspace and Done. Used instead of the native keyboard on touch
 * devices, whose decimal pad has no minus key.
 *
 * Buttons swallow pointerdown so tapping them never moves focus or counts as
 * an outside tap for the editor underneath.
 */
export function MoneyKeypad({
  onKey,
  onDone,
  anchorRef,
  operators = "full",
  quickActions,
}: {
  onKey: (key: AssignmentKey) => void;
  onDone: () => void;
  /** The field being edited. Its scroll container gets bottom padding while
   * the pad is open so the field can scroll above it (modals scroll inside
   * their own overlay, not the page). */
  anchorRef?: React.RefObject<Element | null>;
  /** "full": - + = (delta entry); "sign": - and + set the sign; "none":
   * digits only (the operator keys are left blank). */
  operators?: "full" | "sign" | "none";
  quickActions?: KeypadQuickAction[];
}) {
  const hasActions = !!quickActions?.length;
  React.useEffect(() => {
    const target = scrollParentOf(anchorRef?.current ?? null);
    const previous = target.style.paddingBottom;
    target.style.paddingBottom = hasActions ? KEYPAD_INSET_WITH_ACTIONS : KEYPAD_INSET;
    return () => {
      target.style.paddingBottom = previous;
    };
  }, [anchorRef, hasActions]);

  function key(label: React.ReactNode, value: AssignmentKey, className?: string) {
    return (
      <button
        type="button"
        aria-label={typeof label === "string" ? label : value}
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onKey(value)}
        className={cn(keyClass, className)}
      >
        {label}
      </button>
    );
  }

  const operator = "text-brand-text";
  const blank = <span aria-hidden />;
  const portalTarget = usePortalTarget();
  const showSign = operators !== "none";
  const showEquals = operators === "full";

  return createPortal(
    <div
      {...{ [MONEY_KEYPAD_ATTR]: "" }}
      className="animate-in slide-in-from-bottom duration-200 motion-reduce:animate-none fixed inset-x-0 bottom-0 z-[60] rounded-t-ds-xl border-t bg-surface-raised px-3 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-ink shadow-sheet"
    >
      {hasActions && (
        <div className="mb-2 flex gap-2">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={action.onSelect}
              className="flex h-[60px] flex-1 flex-col items-center justify-center gap-0.5 rounded-ds-md bg-surface text-caption select-none touch-manipulation active:brightness-95 [&_svg]:size-5"
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-4 gap-1">
        {key("7", "7")}
        {key("8", "8")}
        {key("9", "9")}
        {showSign ? key(<Minus size={22} />, "-", operator) : blank}
        {key("4", "4")}
        {key("5", "5")}
        {key("6", "6")}
        {showSign ? key(<Plus size={22} />, "+", operator) : blank}
        {key("1", "1")}
        {key("2", "2")}
        {key("3", "3")}
        {showEquals ? key(<Equal size={22} />, "=", operator) : blank}
        {key(<CircleX size={24} className="text-ink-muted" />, "clear")}
        {key("0", "0")}
        {key(<Delete size={24} className="text-ink-muted" />, "backspace")}
        <Button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onDone}
          className="mx-1 h-14 select-none touch-manipulation"
        >
          Done
        </Button>
      </div>
    </div>,
    portalTarget ?? document.body,
  );
}
