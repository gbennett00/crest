"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePortalTarget } from "@/components/ui/overlay-container";
import { useKeyboardFrame } from "@/components/ui/use-keyboard-frame";
import type { CategoryOption } from "./transaction-form";
import { CategoryList } from "./category-list";

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
  const portalTarget = usePortalTarget();
  // Its search field autofocuses: keep the list above the on-screen keyboard.
  const keyboardFrame = useKeyboardFrame(open);

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
        portalTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-scrim sm:items-center"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
            role="dialog"
            aria-modal="true"
          >
            <div
              style={
                keyboardFrame
                  ? {
                      // Fixed to sit on the keyboard; auto margins keep the
                      // max-width (sm+) panel centred.
                      position: "fixed",
                      left: 0,
                      right: 0,
                      marginInline: "auto",
                      ...keyboardFrame,
                      height: keyboardFrame.maxHeight,
                    }
                  : undefined
              }
              className="flex h-[85dvh] w-full flex-col overflow-hidden rounded-t-ds-xl border border-b-0 bg-surface-raised text-ink shadow-sheet sm:h-[70vh] sm:max-w-sm sm:rounded-ds-xl sm:border-b">
              <div aria-hidden="true" className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-pill bg-border-strong" />
              <div className="flex shrink-0 items-center justify-between gap-2 py-1 pl-5 pr-3">
                <h2 className="text-title">Choose category</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex h-tap w-tap items-center justify-center text-ink-muted hover:text-ink"
                >
                  <X size={24} strokeWidth={1.75} />
                </button>
              </div>

              <div className="mx-4 mb-3 flex h-12 shrink-0 items-center gap-2.5 rounded-ds-md border border-border-strong bg-surface-sunken px-3.5 focus-within:border-focus">
                <Search size={20} strokeWidth={1.75} className="shrink-0 text-ink-subtle" />
                <input
                  ref={searchRef}
                  // Focus on mount, synchronously inside the tap that opened the
                  // picker — mobile browsers only raise the keyboard for that;
                  // the delayed focus() in the effect is just a fallback.
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search categories"
                  // 16px stops iOS from zooming in on focus.
                  className="h-full min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-subtle focus:outline-none"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="-mr-2 flex h-9 w-9 items-center justify-center rounded-pill text-ink-muted hover:text-ink"
                  >
                    <X size={18} strokeWidth={1.75} />
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain border-t pb-[env(safe-area-inset-bottom)]">
                <CategoryList
                  categories={categories}
                  value={value}
                  onSelect={choose}
                  query={query}
                  noneLabel={noneLabel}
                />
              </div>
            </div>
          </div>,
          portalTarget,
        )}
    </>
  );
}
