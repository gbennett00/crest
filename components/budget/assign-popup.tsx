"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { bulkAssign } from "@/app/(app)/budget/actions";
import type { BudgetData, TargetData } from "./budget-screen";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMonth(month: string) {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

type EntryKey = string; // `c:${categoryId}` or `g:${groupId}`

type Entry = {
  key: EntryKey;
  type: "category" | "group";
  id: string;
  name: string;
  groupName: string;
  originalAssigned: number;
  currentAvailable: number; // available based on server state (before popup edits)
  target: TargetData | null;
};

function buildEntries(data: BudgetData): Entry[] {
  const entries: Entry[] = [];
  for (const group of data.groups) {
    if (group.budgetMode === "group") {
      entries.push({
        key: `g:${group.id}`,
        type: "group",
        id: group.id,
        name: group.name,
        groupName: "Group budget",
        originalAssigned: group.groupAssignedCents,
        currentAvailable: group.groupAvailableCents,
        target: group.target,
      });
    } else {
      for (const cat of group.categories) {
        if (cat.role === "ready_to_assign" || cat.isHidden) continue;
        entries.push({
          key: `c:${cat.id}`,
          type: "category",
          id: cat.id,
          name: cat.name,
          groupName: group.name,
          originalAssigned: cat.assignedCents,
          currentAvailable: cat.availableCents,
          target: cat.target,
        });
      }
    }
  }
  return entries;
}

function targetNeed(target: TargetData, draftAssigned: number, currentAvailable: number, draftDelta: number): number {
  const draftAvailable = currentAvailable + draftDelta;
  if (target.type === "fill_up_to") {
    // Fill so that available >= target amount
    return Math.max(0, target.amountCents - draftAvailable);
  }
  if (target.type === "set_aside") {
    // Assign target amount this month
    return Math.max(0, target.amountCents - draftAssigned);
  }
  if (target.type === "by_date") {
    // For simplicity, treat as a monthly set-aside
    return Math.max(0, target.amountCents - draftAssigned);
  }
  return 0;
}

export function AssignPopup({
  data,
  onClose,
}: {
  data: BudgetData;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const entries = useMemo(() => buildEntries(data), [data]);

  // Draft assignment values — keyed by entry key
  const [drafts, setDrafts] = useState<Record<EntryKey, number>>(() => {
    const m: Record<EntryKey, number> = {};
    for (const e of entries) m[e.key] = e.originalAssigned;
    return m;
  });

  // How much the total assigned has changed from the server state
  const totalDraftChange = entries.reduce(
    (sum, e) => sum + ((drafts[e.key] ?? e.originalAssigned) - e.originalAssigned),
    0,
  );

  const rtaDraft = data.rtaAvailableCents - totalDraftChange;

  function setDraft(key: EntryKey, value: number) {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }

  function handleAssignByTargets() {
    let remaining = rtaDraft;
    if (remaining <= 0) return;

    const newDrafts = { ...drafts };

    for (const entry of entries) {
      if (!entry.target || remaining <= 0) continue;
      const current = newDrafts[entry.key] ?? entry.originalAssigned;
      const delta = current - entry.originalAssigned;
      const need = targetNeed(entry.target, current, entry.currentAvailable, delta);
      if (need <= 0) continue;
      const assign = Math.min(need, remaining);
      newDrafts[entry.key] = current + assign;
      remaining -= assign;
    }

    setDrafts(newDrafts);
  }

  function handleSave() {
    setError(null);
    const assignments = entries
      .filter((e) => (drafts[e.key] ?? e.originalAssigned) !== e.originalAssigned)
      .map((e) => ({
        type: e.type,
        id: e.id,
        amountCents: drafts[e.key] ?? e.originalAssigned,
      }));

    // Always save all assignments (even unchanged) to be safe
    const allAssignments = entries.map((e) => ({
      type: e.type,
      id: e.id,
      amountCents: drafts[e.key] ?? e.originalAssigned,
    }));

    startTransition(async () => {
      const result = await bulkAssign(allAssignments, data.month);
      if (result?.success) {
        router.refresh();
        onClose();
      } else {
        setError("Failed to save assignments.");
      }
    });

    void assignments; // suppress lint warning
  }

  // Group entries by group name for display
  const grouped: { groupName: string; entries: Entry[] }[] = [];
  for (const entry of entries) {
    const last = grouped[grouped.length - 1];
    if (last && last.groupName === entry.groupName) {
      last.entries.push(entry);
    } else {
      grouped.push({ groupName: entry.groupName, entries: [entry] });
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center">
      <div className="bg-background w-full sm:max-w-lg sm:rounded-2xl flex flex-col max-h-[92dvh] sm:max-h-[85dvh] shadow-2xl">

        {/* Sticky header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="font-semibold text-base">Assign {formatMonth(data.month)}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Sticky RTA + targets button */}
        <div className="px-5 py-4 border-b bg-muted/20 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Ready to Assign</p>
            <p
              className={cn(
                "text-xl font-bold tabular-nums",
                rtaDraft < 0 ? "text-destructive" : "text-primary",
              )}
            >
              {formatCents(rtaDraft)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 h-8 text-xs"
            onClick={handleAssignByTargets}
            disabled={rtaDraft <= 0}
          >
            <Target size={13} />
            Assign by Targets
          </Button>
        </div>

        {/* Scrollable category list */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {grouped.map(({ groupName, entries: groupEntries }) => (
            <div key={groupName}>
              <div className="px-5 py-2 bg-muted/30 border-b">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {groupName}
                </p>
              </div>
              {groupEntries.map((entry) => {
                const draft = drafts[entry.key] ?? entry.originalAssigned;
                const delta = draft - entry.originalAssigned;
                const draftAvailable = entry.currentAvailable + delta;
                return (
                  <EntryRow
                    key={entry.key}
                    entry={entry}
                    draft={draft}
                    draftAvailable={draftAvailable}
                    onChange={(v) => setDraft(entry.key, v)}
                  />
                );
              })}
            </div>
          ))}
          {entries.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-16">
              No categories yet.
            </p>
          )}
        </div>

        {/* Sticky footer */}
        <div className="px-5 py-4 border-t bg-background shrink-0 space-y-2">
          {error && <p className="text-xs text-destructive text-center">{error}</p>}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave}>
              Save Assignments
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  draft,
  draftAvailable,
  onChange,
}: {
  entry: Entry;
  draft: number;
  draftAvailable: number;
  onChange: (cents: number) => void;
}) {
  const [inputVal, setInputVal] = useState(draft === 0 ? "" : (draft / 100).toFixed(2));
  const [focused, setFocused] = useState(false);

  function handleFocus() {
    setFocused(true);
    setInputVal(draft === 0 ? "" : (draft / 100).toFixed(2));
  }

  function commit(raw: string) {
    setFocused(false);
    const parsed = parseFloat(raw);
    if (raw === "" || isNaN(parsed)) {
      onChange(0);
      setInputVal("");
    } else {
      const cents = Math.round(parsed * 100);
      onChange(cents);
      setInputVal(cents === 0 ? "" : (cents / 100).toFixed(2));
    }
  }

  // Sync display when parent changes value (e.g., Assign by Targets)
  const displayVal = focused ? inputVal : (draft === 0 ? "" : (draft / 100).toFixed(2));

  return (
    <div className="flex items-center gap-3 px-5 py-3 border-b last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{entry.name}</p>
        {entry.target && (
          <p className="text-xs text-muted-foreground">
            Target: {formatCents(entry.target.amountCents)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {/* Available after draft */}
        <span
          className={cn(
            "text-xs tabular-nums w-16 text-right",
            draftAvailable < 0
              ? "text-destructive font-medium"
              : draftAvailable === 0
                ? "text-muted-foreground"
                : "text-green-600 dark:text-green-400",
          )}
        >
          {formatCents(draftAvailable)}
        </span>
        {/* Assignment input */}
        <div className="relative w-24">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">
            $
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={displayVal}
            placeholder="0.00"
            onFocus={handleFocus}
            onChange={(e) => setInputVal(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className={cn(
              "w-full rounded-md border border-input bg-background pl-5 pr-2 py-1.5 text-sm text-right",
              "focus:outline-none focus:ring-1 focus:ring-ring",
              "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
            )}
          />
        </div>
      </div>
    </div>
  );
}
