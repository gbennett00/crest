"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: string };

type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  className?: string;
};

// Beyond this, labels stop fitting a row and it becomes a scrolling chip row.
const MAX_SEGMENTS = 4;

/**
 * Chooses one of a few mutually exclusive options inline (transaction
 * direction, budgeting mode, report range). Two to four options render as a
 * filled track; more become horizontally scrolling chips.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: SegmentedProps<T>) {
  const chips = options.length > MAX_SEGMENTS;
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        chips
          ? "flex gap-2 overflow-x-auto"
          : "flex gap-1 rounded-pill border bg-surface-sunken p-1",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-9 whitespace-nowrap rounded-pill px-4 text-[15px] font-semibold leading-5 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              chips ? "min-h-tap border border-border-strong" : "flex-1",
              selected
                ? "border-brand bg-brand text-brand-ink"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
