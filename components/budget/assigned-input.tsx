"use client";

import { useState } from "react";
import { CurrencyInput } from "@/components/ui/currency-input";
import { useFormattedCents } from "@/components/money";
import { cn } from "@/lib/utils";

interface AssignedInputProps {
  value: number;
  onSave: (cents: number) => void;
  className?: string;
}

export function AssignedInput({ value, onSave, className }: AssignedInputProps) {
  const formatCents = useFormattedCents();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(0);

  function startEditing() {
    setDraft(value);
    setEditing(true);
  }

  function commit() {
    onSave(draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <CurrencyInput
        autoFocus
        cents={draft}
        onCentsChange={setDraft}
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
