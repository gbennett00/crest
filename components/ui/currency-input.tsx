"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { centsFromDigits, formatCentsInput } from "@/lib/currency-input";

export interface CurrencyInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "defaultValue" | "onChange" | "type" | "inputMode"
  > {
  /** The current amount in integer cents. Always authoritative — the field
   * never holds a "raw" intermediate string of its own. */
  cents: number;
  onCentsChange: (cents: number) => void;
  /** Lets the user flip the sign with the "-" key (e.g. a reconciled
   * balance). Digits-only fields (assignments, transaction amounts) omit
   * this since a negative value never makes sense there. */
  allowNegative?: boolean;
}

/**
 * A cents-based money input: the cursor is always effectively at the end —
 * typing a digit shifts it in as the new rightmost digit (cents = cents*10 +
 * digit) and Backspace/Delete shifts the rightmost digit back out — the same
 * model as a point-of-sale keypad. There's no free-text editing, so the
 * usual "click to position the cursor, retype the cents" friction of a plain
 * text field doesn't come up.
 *
 * Digit entry and Backspace/Delete are left to the browser's native text
 * editing (more reliable than intercepting keydown, especially for mobile
 * IME/virtual keyboards); `handleChange` just re-derives cents from
 * whatever digits ended up in the field. The cursor is pinned to the end on
 * every interaction so it can never actually land mid-value.
 */
export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  (
    {
      cents,
      onCentsChange,
      allowNegative = false,
      className,
      onFocus,
      onClick,
      onSelect,
      onKeyUp,
      onKeyDown,
      ...props
    },
    forwardedRef,
  ) => {
    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLInputElement);

    // Sign is tracked separately from `cents` so a pending "-" survives at a
    // zero amount (0 and -0 display identically, so the sign would otherwise
    // have nowhere to live while the user is still about to type digits).
    const [sign, setSign] = React.useState<1 | -1>(cents < 0 ? -1 : 1);
    React.useEffect(() => {
      if (cents > 0) setSign(1);
      else if (cents < 0) setSign(-1);
    }, [cents]);

    const display = formatCentsInput(cents);

    function pinToEnd() {
      const el = innerRef.current;
      if (!el) return;
      const len = el.value.length;
      if (el.selectionStart !== len || el.selectionEnd !== len) {
        el.setSelectionRange(len, len);
      }
    }

    // Covers the case where React resets selection after the value
    // reformats following a keystroke.
    React.useEffect(() => {
      pinToEnd();
    });

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      onCentsChange(centsFromDigits(e.target.value, sign));
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (
        allowNegative &&
        e.key === "-" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        const nextSign = sign === 1 ? -1 : 1;
        setSign(nextSign);
        if (cents !== 0) onCentsChange(nextSign * Math.abs(cents));
      }
      onKeyDown?.(e);
    }

    return (
      <input
        {...props}
        ref={innerRef}
        type="text"
        inputMode={allowNegative ? "text" : "decimal"}
        value={display}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={(e) => {
          pinToEnd();
          onFocus?.(e);
        }}
        onClick={(e) => {
          pinToEnd();
          onClick?.(e);
        }}
        onSelect={(e) => {
          pinToEnd();
          onSelect?.(e);
        }}
        onKeyUp={(e) => {
          pinToEnd();
          onKeyUp?.(e);
        }}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
      />
    );
  },
);
CurrencyInput.displayName = "CurrencyInput";
