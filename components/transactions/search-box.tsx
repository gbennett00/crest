"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Collapses to a bare icon button when there's nothing to show, so it doesn't
 * cost a full input's width until the user actually wants to search. Stays
 * expanded whenever there's text — typed, or restored via browser
 * back/forward/a shared link — and only collapses back on blur with an empty
 * value.
 */
export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [expanded, setExpanded] = useState(() => !!value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value) setExpanded(true);
  }, [value]);

  function open() {
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function collapseIfEmpty() {
    if (!value) setExpanded(false);
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={open}
        aria-label="Search transactions"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Search size={15} />
      </button>
    );
  }

  return (
    <div className="relative flex-1 min-w-[8rem]">
      <Search
        size={15}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
      />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={collapseIfEmpty}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (value) onChange("");
            else e.currentTarget.blur();
          }
        }}
        placeholder="Search payee, category, or memo…"
        className={cn("pl-8", value && "pr-8")}
        aria-label="Search transactions"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
