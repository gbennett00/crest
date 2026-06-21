"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatCents, parseMoneyExpression } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AssignedInputProps {
  value: number;
  onSave: (cents: number) => void;
  className?: string;
}

export function AssignedInput({ value, onSave, className }: AssignedInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function startEditing() {
    // Prefill with the current value so the user can append "+23.49" or
    // "-23.49" to adjust it without retyping the whole amount.
    setDraft(value === 0 ? "" : (value / 100).toFixed(2));
    setEditing(true);
  }

  function commit() {
    const cents = parseMoneyExpression(draft);
    if (cents !== null) {
      onSave(cents);
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        autoFocus
        // type="text" (not "number") so "+"/"-" expressions are accepted, but
        // inputMode="decimal" opens the numeric keypad on mobile by default.
        type="text"
        inputMode="decimal"
        value={draft}
        // Place the cursor at the end so typing continues after the prefilled
        // amount rather than overwriting it.
        onFocus={(e) => {
          const len = e.target.value.length;
          e.target.setSelectionRange(len, len);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        // text-base on mobile (16px) stops iOS from zooming on focus; md:text-sm
        // keeps the compact desktop size.
        className={cn("h-7 text-right text-base md:text-sm py-0 px-1.5", className)}
      />
    );
  }

  return (
    <button
      onClick={startEditing}
      className={cn(
        "w-full text-right text-sm rounded px-1 py-0.5 transition-colors hover:bg-accent",
        value === 0 && "text-muted-foreground",
        className,
      )}
    >
      {formatCents(value)}
    </button>
  );
}
