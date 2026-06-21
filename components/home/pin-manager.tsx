"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pin, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { togglePin } from "@/app/(app)/budget/actions";
import type { BudgetData } from "@/lib/budget/types";

type PinEntry = {
  key: string; // `g:${id}` or `c:${id}`
  id: string;
  type: "category" | "group";
  name: string;
  groupName: string;
  pinned: boolean;
};

function buildEntries(data: BudgetData): PinEntry[] {
  const entries: PinEntry[] = [];
  for (const group of data.groups) {
    const visibleCats = group.categories.filter(
      (c) => c.role !== "ready_to_assign" && !c.isHidden,
    );
    // Skip empty/system-only groups.
    if (visibleCats.length === 0) continue;

    if (group.budgetMode === "group") {
      entries.push({
        key: `g:${group.id}`,
        id: group.id,
        type: "group",
        name: group.name,
        groupName: "Group budget",
        pinned: group.isPinned,
      });
    } else {
      for (const cat of visibleCats) {
        entries.push({
          key: `c:${cat.id}`,
          id: cat.id,
          type: "category",
          name: cat.name,
          groupName: group.name,
          pinned: cat.isPinned,
        });
      }
    }
  }
  return entries;
}

export function PinManager({ data }: { data: BudgetData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const entries = useMemo(() => buildEntries(data), [data]);

  // Local override of pinned state so the checkboxes feel instant; togglePin
  // flips the persisted value server-side.
  const [pinned, setPinned] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const e of entries) m[e.key] = e.pinned;
    return m;
  });

  function toggle(entry: PinEntry) {
    setPinned((prev) => ({ ...prev, [entry.key]: !prev[entry.key] }));
    startTransition(async () => {
      await togglePin(entry.id, entry.type);
    });
  }

  function close() {
    setOpen(false);
    router.refresh();
  }

  // Group entries under their group name for display.
  const grouped: { groupName: string; entries: PinEntry[] }[] = [];
  for (const entry of entries) {
    const last = grouped[grouped.length - 1];
    if (last && last.groupName === entry.groupName) last.entries.push(entry);
    else grouped.push({ groupName: entry.groupName, entries: [entry] });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <Pin size={12} />
        Manage
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center">
          <div className="bg-background w-full sm:max-w-lg sm:rounded-2xl flex flex-col max-h-[92dvh] sm:max-h-[85dvh] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <div>
                <h2 className="font-semibold text-base">Pin to Home</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pinned categories show up on your Home screen.
                </p>
              </div>
              <button
                onClick={close}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0">
              {grouped.map(({ groupName, entries: groupEntries }) => (
                <div key={groupName}>
                  <div className="px-5 py-2 bg-muted/30 border-b">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {groupName}
                    </p>
                  </div>
                  {groupEntries.map((entry) => (
                    <label
                      key={entry.key}
                      className="flex items-center gap-3 px-5 py-3 border-b cursor-pointer hover:bg-muted/30 transition-colors"
                    >
                      <Checkbox
                        checked={!!pinned[entry.key]}
                        onCheckedChange={() => toggle(entry)}
                      />
                      <span
                        className={cn(
                          "text-sm",
                          pinned[entry.key] ? "font-medium" : "",
                        )}
                      >
                        {entry.name}
                      </span>
                    </label>
                  ))}
                </div>
              ))}
              {entries.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-16">
                  No categories yet.
                </p>
              )}
            </div>

            <div className="px-5 py-4 border-t bg-background shrink-0">
              <button
                onClick={close}
                className="w-full bg-primary text-primary-foreground rounded-md py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
