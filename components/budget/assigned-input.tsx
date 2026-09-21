"use client";

import { useState } from "react";
import { AssignmentAmountEditor } from "@/components/ui/assignment-amount-input";
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

  if (editing) {
    return (
      <AssignmentAmountEditor
        original={value}
        onCommit={(cents) => {
          onSave(cents);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
        formatCents={formatCents}
        // text-base on mobile (16px) stops iOS from zooming on focus; md:text-sm
        // keeps the compact desktop size.
        className={cn("h-7 text-right text-base md:text-sm py-0 px-1.5", className)}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
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
