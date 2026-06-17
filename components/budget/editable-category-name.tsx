"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { renameCategory } from "@/app/(app)/budget/actions";

interface EditableCategoryNameProps {
  categoryId: string;
  name: string;
}

export function EditableCategoryName({ categoryId, name }: EditableCategoryNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startEditing() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await renameCategory(categoryId, trimmed);
      if (result?.error) {
        setError(result.error);
      } else {
        setEditing(false);
      }
    });
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        disabled={isPending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setError(null);
            setEditing(false);
          }
        }}
        title={error ?? undefined}
        className={cn("h-6 text-sm py-0 px-1.5", error && "border-destructive")}
      />
    );
  }

  return (
    <button
      onClick={startEditing}
      title="Rename category"
      className="truncate text-left rounded px-1 -mx-1 py-0.5 transition-colors hover:bg-accent"
    >
      {name}
    </button>
  );
}
