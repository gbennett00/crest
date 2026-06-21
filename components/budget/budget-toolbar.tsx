"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowUpDown, Check, FolderPlus, ListPlus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { createCategory, createGroup } from "@/app/(app)/budget/actions";

type GroupOption = { id: string; name: string };

// Plan-page toolbar: create categories/groups and toggle reorder mode. Replaces
// the inline "Add category"/"Add group" rows that used to live in the list.
export function BudgetToolbar({
  groups,
  reordering,
  onToggleReorder,
}: {
  groups: GroupOption[];
  reordering: boolean;
  onToggleReorder: () => void;
}) {
  const [modal, setModal] = useState<null | "category" | "group">(null);

  return (
    <>
      {reordering ? (
        // While reordering, a direct check button finishes — no dropdown needed.
        <button
          onClick={onToggleReorder}
          className="p-2 rounded text-primary hover:bg-accent transition-colors"
          aria-label="Done reordering"
          title="Done reordering"
        >
          <Check size={18} />
        </button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-2 rounded hover:bg-accent transition-colors text-muted-foreground"
              aria-label="Plan options"
            >
              <Plus size={18} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onSelect={() => setModal("category")}
              className="gap-2"
              disabled={groups.length === 0}
            >
              <ListPlus size={14} /> Add category
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setModal("group")} className="gap-2">
              <FolderPlus size={14} /> Add group
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onToggleReorder} className="gap-2">
              <ArrowUpDown size={14} /> Reorder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {modal === "category" && (
        <AddCategoryModal groups={groups} onClose={() => setModal(null)} />
      )}
      {modal === "group" && <AddGroupModal onClose={() => setModal(null)} />}
    </>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center">
      <div className="bg-background w-full sm:max-w-md sm:rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-base">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function AddCategoryModal({
  groups,
  onClose,
}: {
  groups: GroupOption[];
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createCategory(formData);
      if (result?.error) setError(result.error);
      else onClose();
    });
  }

  return (
    <ModalShell title="Add category" onClose={onClose}>
      <form ref={formRef} action={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Group</label>
          <select
            name="groupId"
            required
            defaultValue={groups[0]?.id}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm h-9 focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Name</label>
          <Input name="name" placeholder="Category name" required autoFocus className="h-9 text-sm" />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={isPending}>
            {isPending ? "Adding…" : "Add category"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function AddGroupModal({ onClose }: { onClose: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [budgetMode, setBudgetMode] = useState<"category" | "group">("category");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    formData.set("budgetMode", budgetMode);
    startTransition(async () => {
      const result = await createGroup(formData);
      if (result?.error) setError(result.error);
      else onClose();
    });
  }

  return (
    <ModalShell title="Add group" onClose={onClose}>
      <form ref={formRef} action={handleSubmit} className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Name</label>
          <Input name="name" placeholder="Group name" required autoFocus className="h-9 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Budgeting</label>
          <div className="flex gap-2 text-xs">
            {(["category", "group"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setBudgetMode(mode)}
                className={cn(
                  "px-3 py-1.5 rounded border transition-colors",
                  budgetMode === mode
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-input bg-background hover:bg-muted",
                )}
              >
                {mode === "category" ? "Per category" : "Group pool"}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={isPending}>
            {isPending ? "Adding…" : "Add group"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
