"use client";

import { useState } from "react";
import { AssignmentAmountEditor } from "@/components/ui/assignment-amount-input";
import type { KeypadQuickAction } from "@/components/ui/money-keypad";
import { useFormattedCents } from "@/components/money";
import { cn } from "@/lib/utils";

interface AssignedInputProps {
  value: number;
  onSave: (cents: number) => void;
  /** Accessible name of what is being assigned, e.g. "Dating". */
  label?: string;
  /** Lets the row tint itself while its value is being edited. */
  onEditingChange?: (editing: boolean) => void;
  /** Chips shown above the touch keypad while editing. */
  quickActions?: KeypadQuickAction[];
  className?: string;
}

// Assigned is plain text, not a box: the only editing affordance is the row
// tint, a brand-coloured value and a caret (see the design system's Keypad).
export function AssignedInput({
  value,
  onSave,
  label,
  onEditingChange,
  quickActions,
  className,
}: AssignedInputProps) {
  const formatCents = useFormattedCents();
  const [editing, setEditingState] = useState(false);

  function setEditing(next: boolean) {
    setEditingState(next);
    onEditingChange?.(next);
  }

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
        quickActions={quickActions}
        className={cn(
          "min-h-tap border-transparent bg-transparent px-0 py-0 text-amount-sm text-brand-text",
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={label ? `Assigned for ${label}: ${formatCents(value)}. Edit` : undefined}
      className={cn(
        "num h-tap w-full whitespace-nowrap text-right text-amount-sm",
        value === 0 ? "text-ink-muted" : "text-ink",
        className,
      )}
    >
      {formatCents(value)}
    </button>
  );
}
