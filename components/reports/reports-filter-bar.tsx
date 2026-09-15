"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Minus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReportViews } from "@/lib/reports/use-report-views";

export type FilterGroup = {
  id: string;
  name: string;
  categories: { id: string; name: string }[];
};

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * The category/group multi-select trigger + popover, plus the saved-view
 * quick-switch chips next to it. Saved views live in localStorage only (no
 * server round trip) — that's the whole point: switching between the same
 * 2-3 subsets should be instant.
 */
export function ReportsFilterBar({
  groups,
  selectedCategoryIds,
  onApply,
}: {
  groups: FilterGroup[];
  selectedCategoryIds: string[];
  onApply: (categoryIds: string[]) => void;
}) {
  const { views, save, remove } = useReportViews();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set(selectedCategoryIds));
  const [search, setSearch] = useState("");
  const [saveName, setSaveName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  function openPicker() {
    setPending(new Set(selectedCategoryIds));
    setSearch("");
    setOpen(true);
  }

  function closeAndApply() {
    setOpen(false);
    const next = [...pendingRef.current];
    if (!sameSet(next, selectedCategoryIds)) onApply(next);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) closeAndApply();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeAndApply();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleCategory(id: string) {
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(group: FilterGroup) {
    const ids = group.categories.map((c) => c.id);
    const allSelected = ids.length > 0 && ids.every((id) => pending.has(id));
    setPending((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function applySavedView(categoryIds: string[]) {
    onApply(categoryIds);
    setPending(new Set(categoryIds));
  }

  function handleSave() {
    const name = saveName.trim();
    if (!name || pending.size === 0) return;
    save(name, [...pending]);
    setSaveName("");
  }

  const q = search.trim().toLowerCase();
  const visibleGroups = q
    ? groups
        .map((g) => {
          const groupMatches = g.name.toLowerCase().includes(q);
          const categories = groupMatches
            ? g.categories
            : g.categories.filter((c) => c.name.toLowerCase().includes(q));
          return { ...g, categories };
        })
        .filter((g) => g.categories.length > 0)
    : groups;

  const triggerLabel =
    selectedCategoryIds.length === 0 ? "All Categories" : `${selectedCategoryIds.length} Categories`;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => (open ? closeAndApply() : openPicker())}
          className={cn(
            "flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-[13px] font-medium bg-background shadow-sm transition-colors",
            open ? "border-primary" : "border-input hover:bg-accent",
          )}
        >
          {triggerLabel}
          <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-30 mt-1.5 w-80 rounded-xl border bg-popover shadow-lg overflow-hidden flex flex-col">
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b">
              <Search size={14} className="text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter categories…"
                className="flex-1 min-w-0 bg-transparent text-[13px] focus:outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="max-h-80 overflow-y-auto">
              {visibleGroups.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">No matches.</p>
              )}
              {visibleGroups.map((group) => {
                const ids = group.categories.map((c) => c.id);
                const selectedCount = ids.filter((id) => pending.has(id)).length;
                const checked = ids.length > 0 && selectedCount === ids.length;
                const indeterminate = selectedCount > 0 && !checked;
                return (
                  <div key={group.id}>
                    <div className="flex items-center gap-2.5 px-3.5 py-2 bg-muted/40">
                      <TriBox
                        checked={checked}
                        indeterminate={indeterminate}
                        onClick={() => toggleGroup(group)}
                      />
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.name}
                      </span>
                    </div>
                    {group.categories.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2.5 pl-9 pr-3.5 py-1.5 cursor-pointer hover:bg-accent"
                      >
                        <TriBox checked={pending.has(c.id)} onClick={() => toggleCategory(c.id)} />
                        <span className="text-[13.5px]">{c.name}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>

            <div className="border-t p-3 flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                  }}
                  placeholder="Name this selection…"
                  className="flex-1 min-w-0 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!saveName.trim() || pending.size === 0}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40"
                >
                  Save
                </button>
              </div>
              {views.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {views.map((v) => (
                    <SavedChip
                      key={v.id}
                      label={v.name}
                      active={sameSet(v.categoryIds, [...pending])}
                      onClick={() => applySavedView(v.categoryIds)}
                      onRemove={() => remove(v.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {views.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {views.map((v) => (
            <SavedChip
              key={v.id}
              label={v.name}
              active={sameSet(v.categoryIds, selectedCategoryIds)}
              onClick={() => applySavedView(v.categoryIds)}
              onRemove={() => remove(v.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TriBox({
  checked,
  indeterminate,
  onClick,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        "w-[17px] h-[17px] rounded-[5px] border-[1.5px] shrink-0 flex items-center justify-center transition-colors",
        checked || indeterminate ? "bg-primary border-primary" : "border-input",
      )}
    >
      {checked && !indeterminate && <Check />}
      {indeterminate && <Minus size={11} className="text-primary-foreground" strokeWidth={3} />}
    </button>
  );
}

function Check() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SavedChip({
  label,
  active,
  onClick,
  onRemove,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 pl-3 pr-1.5 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap",
        active
          ? "bg-accent text-accent-foreground border-primary/30"
          : "border-border text-muted-foreground",
      )}
    >
      <button type="button" onClick={onClick} className="hover:underline">
        {label}
      </button>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10"
      >
        <X size={11} />
      </button>
    </span>
  );
}
