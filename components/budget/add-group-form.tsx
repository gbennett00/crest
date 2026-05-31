"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createGroup } from "@/app/(app)/budget/actions";
import { Plus, X } from "lucide-react";

export function AddGroupForm() {
  const [open, setOpen] = useState(false);
  const [budgetMode, setBudgetMode] = useState<"category" | "group">("category");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    formData.set("budgetMode", budgetMode);
    startTransition(async () => {
      const result = await createGroup(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setOpen(false);
        setBudgetMode("category");
        formRef.current?.reset();
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors w-full border-t"
      >
        <Plus size={13} />
        Add Group
      </button>
    );
  }

  return (
    <div className="border-t px-4 py-3 space-y-3 bg-muted/10">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">New Group</span>
        <button onClick={() => { setOpen(false); setError(null); }} className="text-muted-foreground hover:text-foreground">
          <X size={14} />
        </button>
      </div>
      <form ref={formRef} action={handleSubmit} className="space-y-2">
        <Input name="name" placeholder="Group name" required className="h-8 text-sm" />
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 text-xs">
            <button
              type="button"
              onClick={() => setBudgetMode("category")}
              className={cn(
                "px-2.5 py-1 rounded border transition-colors",
                budgetMode === "category" ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background hover:bg-muted",
              )}
            >
              Per category
            </button>
            <button
              type="button"
              onClick={() => setBudgetMode("group")}
              className={cn(
                "px-2.5 py-1 rounded border transition-colors",
                budgetMode === "group" ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background hover:bg-muted",
              )}
            >
              Group pool
            </button>
          </div>
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" className="h-7 text-xs" disabled={isPending}>
              {isPending ? "Adding…" : "Add Group"}
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setOpen(false); setError(null); }}>
              Cancel
            </Button>
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </form>
    </div>
  );
}
