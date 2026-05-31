"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AssignedInputProps {
  value: number;
  onSave: (cents: number) => void;
  className?: string;
}

export function AssignedInput({ value, onSave, className }: AssignedInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function startEditing() {
    setDraft(value === 0 ? "" : (Math.abs(value) / 100).toFixed(2));
    setEditing(true);
  }

  function commit() {
    const dollars = parseFloat(draft);
    if (!isNaN(dollars) && dollars >= 0) {
      onSave(Math.round(dollars * 100));
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        autoFocus
        type="number"
        min="0"
        step="0.01"
        value={draft}
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
        className={cn("h-7 text-right text-sm py-0 px-1.5", className)}
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
