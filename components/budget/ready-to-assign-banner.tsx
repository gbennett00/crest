"use client";

import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Money } from "@/components/money";
import { readyToAssignState, type ReadyToAssignState } from "@/lib/ready-to-assign";

const STATE_STYLES: Record<ReadyToAssignState, string> = {
  assign: "bg-brand text-brand-ink",
  done: "bg-brand-subtle text-brand-text",
  over: "bg-neg-bg text-neg-ink",
};

const STATE_LABELS: Record<ReadyToAssignState, string> = {
  assign: "Ready to assign",
  done: "All assigned",
  over: "Over-assigned",
};

/**
 * The slim Plan banner. Amount on the left, label and chevron on the right
 * (the one place the label follows the value). Tapping opens the Assign
 * sheet; when everything is assigned there is nothing to open.
 */
export function ReadyToAssignBanner({
  cents,
  onPress,
  className,
}: {
  cents: number;
  onPress?: () => void;
  className?: string;
}) {
  const state = readyToAssignState(cents);
  const inner = (
    <>
      <span className="num text-banner-amount whitespace-nowrap">
        <Money cents={cents} />
      </span>
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[15px] font-semibold leading-5">
        {STATE_LABELS[state]}
        {state !== "done" && <ChevronRight size={22} strokeWidth={1.75} aria-hidden="true" />}
      </span>
    </>
  );
  const base = cn(
    "flex h-14 w-full items-center justify-between rounded-ds-lg pl-5 pr-4",
    STATE_STYLES[state],
    className,
  );

  if (state === "done" || !onPress) return <div className={base}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        base,
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      {inner}
    </button>
  );
}
