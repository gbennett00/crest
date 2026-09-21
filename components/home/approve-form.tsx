"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useFormattedCents } from "@/components/money";
import { approveWithCategory } from "@/app/(app)/actions";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import { CategoryPicker } from "@/components/transactions/category-picker";

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
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(categories[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = await approveWithCategory(transactionId, selected);
      if (result?.error) setError(result.error);
      else invalidateAllLedgerQueries(queryClient);
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
        <CategoryPicker
          value={selected}
          onChange={setSelected}
          categories={categories}
          disabled={isPending}
          className="flex-1"
        />
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
