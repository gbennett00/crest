"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { renameCategory, renameGroup } from "@/app/(app)/budget/actions";

interface EditableNameProps {
  id: string;
  name: string;
  type: "category" | "group";
  className?: string;
}

export function EditableName({ id, name, type, className }: EditableNameProps) {
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
      const result =
        type === "category"
          ? await renameCategory(id, trimmed)
          : await renameGroup(id, trimmed);
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
        className={cn("h-6 text-sm py-0 px-1.5", error && "border-destructive", className)}
      />
    );
  }

  return (
    <button
      onClick={startEditing}
      title={`Rename ${type}`}
      className={cn(
        "truncate text-left rounded px-1 -mx-1 py-0.5 transition-colors hover:bg-accent",
        className,
      )}
    >
      {name}
    </button>
  );
}
