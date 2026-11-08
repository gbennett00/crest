"use client";

import { useMemo, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { togglePin } from "@/app/(app)/budget/actions";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
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
  const queryClient = useQueryClient();
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
      invalidateAllLedgerQueries(queryClient);
    });
  }

  function close() {
    setOpen(false);
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
      <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
        Manage
      </Button>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Pin to Home"
        subtitle="Pinned categories show up on your Home screen."
        tall
        className="px-0 pb-0"
        footer={
          <Button className="flex-1" onClick={close}>
            Done
          </Button>
        }
      >
        {grouped.map(({ groupName, entries: groupEntries }) => (
          <div key={groupName}>
            <div className="border-y bg-surface-sunken px-5 py-2">
              <p className="text-overline uppercase text-ink-muted">{groupName}</p>
            </div>
            {groupEntries.map((entry) => (
              <label
                key={entry.key}
                className="flex min-h-[52px] cursor-pointer items-center gap-3 border-b px-5 py-2 transition-colors hover:bg-surface"
              >
                <Checkbox
                  checked={!!pinned[entry.key]}
                  onCheckedChange={() => toggle(entry)}
                  className="h-6 w-6 rounded-ds-sm border-2 border-border-strong data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-brand-ink"
                />
                <span
                  className={cn(
                    "truncate text-body text-ink",
                    pinned[entry.key] && "font-semibold",
                  )}
                >
                  {entry.name}
                </span>
              </label>
            ))}
          </div>
        ))}
        {entries.length === 0 && (
          <p className="py-16 text-center text-body text-ink-muted">No categories yet.</p>
        )}
      </Sheet>
    </>
  );
}
