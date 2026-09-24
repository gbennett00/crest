"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CategoryOption } from "./transaction-form";

/**
 * Category select styled and driven like a native app picker: tapping the
 * trigger opens a bottom sheet with a search field over the same
 * grouped/ordered list `<select>` + `<optgroup>` would show, so long category
 * lists don't require scrolling to find one. Categories are shown in
 * whatever order `categories` is given in — callers are expected to already
 * pass them in Plan order (see lib/budget/category-options.ts).
 */
export function CategoryPicker({
  id,
  categories,
  value,
  onChange,
  placeholder = "Select category…",
  noneLabel,
  disabled,
  className,
}: {
  id?: string;
  categories: CategoryOption[];
  value: string;
  onChange: (categoryId: string) => void;
  placeholder?: string;
  /** When set, renders an extra "no category" row above the groups. */
  noneLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const focusTimer = setTimeout(() => searchRef.current?.focus(), 50);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const selected = categories.find((c) => c.id === value) ?? null;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? categories.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.groupName.toLowerCase().includes(q),
        )
      : categories;

    const map = new Map<string, CategoryOption[]>();
    for (const c of filtered) {
      const existing = map.get(c.groupName);
      if (existing) existing.push(c);
      else map.set(c.groupName, [c]);
    }
    return [...map.entries()];
  }, [categories, query]);

  function choose(categoryId: string) {
    onChange(categoryId);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "w-full h-9 flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm",
          "focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
      >
        <span
          className={cn(
            "truncate text-left leading-none",
            !selected && "text-muted-foreground",
          )}
        >
          {selected ? selected.name : placeholder}
        </span>
        <ChevronsUpDown size={14} className="text-muted-foreground shrink-0" />
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex h-[85dvh] w-full flex-col rounded-t-2xl bg-card text-card-foreground shadow-2xl sm:h-[70vh] sm:max-w-sm sm:rounded-2xl">
              <div className="flex items-center justify-between px-4 pb-2 pt-3.5 shrink-0">
                <h2 className="text-sm font-semibold">Choose Category</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 shrink-0">
                <Search size={14} className="text-muted-foreground shrink-0" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search categories…"
                  // text-base (16px) on mobile stops iOS from zooming in on focus.
                  className="min-w-0 flex-1 bg-transparent text-base focus:outline-none sm:text-sm placeholder:text-muted-foreground"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
                {noneLabel && !query.trim() && (
                  <button
                    type="button"
                    onClick={() => choose("")}
                    className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-accent"
                  >
                    <span className="text-muted-foreground">{noneLabel}</span>
                    {!value && (
                      <Check size={15} className="shrink-0 text-primary" />
                    )}
                  </button>
                )}

                {groups.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No categories found.
                  </p>
                )}

                {groups.map(([groupName, cats]) => (
                  <div key={groupName}>
                    <div className="sticky top-0 bg-card/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                      {groupName}
                    </div>
                    {cats.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => choose(c.id)}
                        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate">{c.name}</span>
                        {c.id === value && (
                          <Check size={15} className="shrink-0 text-primary" />
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
