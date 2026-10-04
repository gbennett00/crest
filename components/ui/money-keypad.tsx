"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Delete, Minus, Plus, Equal, CircleX } from "lucide-react";
import type { AssignmentKey } from "@/lib/currency-input";
import { cn } from "@/lib/utils";

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

const KEYPAD_INSET = "20rem";

/** The nearest ancestor that scrolls vertically (a modal overlay, say), else the body. */
function scrollParentOf(el: Element | null): HTMLElement {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return document.body;
}

const keyClass =
  "flex h-14 items-center justify-center rounded-lg text-2xl font-medium select-none touch-manipulation active:bg-accent";

/**
 * A YNAB-style on-screen keypad pinned to the bottom of the viewport: digits,
 * "-"/"+"/"=" for delta entry, clear, backspace and Done. Used instead of the
 * native keyboard on touch devices, whose decimal pad has no minus key.
 *
 * Buttons swallow pointerdown so tapping them never moves focus or counts as
 * an outside tap for the editor underneath.
 */
export function MoneyKeypad({
  onKey,
  onDone,
  anchorRef,
  operators = "full",
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
}) {
  React.useEffect(() => {
    const target = scrollParentOf(anchorRef?.current ?? null);
    const previous = target.style.paddingBottom;
    target.style.paddingBottom = KEYPAD_INSET;
    return () => {
      target.style.paddingBottom = previous;
    };
  }, [anchorRef]);

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

  const operator = "text-primary";
  const blank = <span aria-hidden />;
  const showSign = operators !== "none";
  const showEquals = operators === "full";

  return createPortal(
    <div
      {...{ [MONEY_KEYPAD_ATTR]: "" }}
      className="animate-in slide-in-from-bottom duration-200 motion-reduce:animate-none fixed inset-x-0 bottom-0 z-[60] grid grid-cols-4 gap-1 border-t bg-background px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.12)]"
    >
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
      {key(<CircleX size={24} className="text-muted-foreground" />, "clear")}
      {key("0", "0")}
      {key(<Delete size={24} className="text-muted-foreground" />, "backspace")}
      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDone}
        className="h-14 rounded-full bg-primary text-lg font-semibold text-primary-foreground select-none touch-manipulation active:opacity-80"
      >
        Done
      </button>
    </div>,
    document.body,
  );
}
