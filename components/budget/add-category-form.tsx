"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCategory } from "@/app/(app)/budget/actions";
import { Plus, X } from "lucide-react";

export function AddCategoryForm({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(formData: FormData) {
    setError(null);
    formData.set("groupId", groupId);
    startTransition(async () => {
      const result = await createCategory(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setOpen(false);
        formRef.current?.reset();
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 pl-8 pr-4 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors w-full border-b"
      >
        <Plus size={12} />
        Add category
      </button>
    );
  }

  return (
    <div className="pl-8 pr-4 py-2 border-b bg-muted/10">
      <form ref={formRef} action={handleSubmit} className="flex items-center gap-2">
        <Input name="name" placeholder="Category name" required className="h-7 text-xs flex-1" />
        <Button type="submit" size="sm" className="h-7 text-xs px-3" disabled={isPending}>
          {isPending ? "…" : "Add"}
        </Button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="text-muted-foreground hover:text-foreground"
        >
          <X size={14} />
        </button>
      </form>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
