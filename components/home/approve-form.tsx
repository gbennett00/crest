"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useFormattedCents } from "@/components/money";
import { approveWithCategory } from "@/app/(app)/actions";
import { cn } from "@/lib/utils";

export type CategoryOption = {
  id: string;
  name: string;
  groupName: string;
};

interface ApproveFormProps {
  transactionId: string;
  amountCents: number;
  categories: CategoryOption[];
}

export function ApproveForm({
  transactionId,
  amountCents,
  categories,
}: ApproveFormProps) {
  const formatCents = useFormattedCents();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(categories[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Group categories by group name for <optgroup>
  const grouped: Record<string, CategoryOption[]> = {};
  for (const cat of categories) {
    (grouped[cat.groupName] ??= []).push(cat);
  }

  function submit() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = await approveWithCategory(transactionId, selected);
      if (result?.error) setError(result.error);
    });
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => setOpen(true)}
      >
        Approve
      </Button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className={cn(
            "flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm",
            "focus:outline-none focus:ring-1 focus:ring-ring",
          )}
          disabled={isPending}
        >
          {Object.entries(grouped).map(([group, cats]) => (
            <optgroup key={group} label={group}>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <Button
          size="sm"
          className="h-8 text-xs"
          onClick={submit}
          disabled={isPending || !selected}
        >
          {isPending ? "..." : `Confirm (${formatCents(amountCents)})`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs"
          onClick={() => setOpen(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
