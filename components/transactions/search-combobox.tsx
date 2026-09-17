"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SearchScope } from "@/lib/queries/transactions";
import type { CategoryOption } from "@/components/transactions/transaction-form";

const SCOPE_BADGE: Record<Exclude<SearchScope, "all">, string> = {
  payee: "Payee",
  category: "Category",
  memo: "Memo",
};

const SCOPE_OPTIONS: { scope: SearchScope; label: string | null }[] = [
  { scope: "all", label: null },
  { scope: "payee", label: "Payee:" },
  { scope: "category", label: "Category:" },
  { scope: "memo", label: "Memo:" },
];

/**
 * YNAB-style search: typing shows matching categories (pick one for an exact
 * category filter) plus generic "find in <field>" options (pick one to scope
 * the free-text search to payee/category/memo instead of all three) — one
 * control standing in for what used to be a separate category `<select>`.
 */
export function SearchComboBox({
  q,
  scope,
  categoryId,
  categoryOptions,
  onQueryChange,
  onScopeSelect,
  onCategorySelect,
  onClear,
}: {
  q: string;
  scope: SearchScope;
  categoryId: string;
  categoryOptions: CategoryOption[];
  onQueryChange: (q: string) => void;
  onScopeSelect: (scope: SearchScope) => void;
  onCategorySelect: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);

  const selectedCategoryName = categoryId
    ? (categoryOptions.find((c) => c.id === categoryId)?.name ?? "")
    : "";
  const displayValue = categoryId ? selectedCategoryName : q;
  const needle = q.trim().toLowerCase();

  const matchingCategories = needle
    ? categoryOptions.filter((c) => c.name.toLowerCase().includes(needle)).slice(0, 5)
    : [];

  const showDropdown = open && !categoryId && needle.length > 0;

  const hasScopeBadge = scope !== "all" && !!q;

  return (
    <div className="relative">
      <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
        {hasScopeBadge ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onScopeSelect("all")}
            className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
          >
            {SCOPE_BADGE[scope]}
          </button>
        ) : (
          <Search size={15} className="text-muted-foreground pointer-events-none" />
        )}
      </div>

      <Input
        value={displayValue}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
        placeholder="Search payee, category, or memo…"
        className={cn(hasScopeBadge ? "pl-20" : "pl-8", (q || categoryId) && "pr-8")}
        aria-label="Search transactions"
      />

      {(q || categoryId) && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X size={14} />
        </button>
      )}

      {showDropdown && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-lg overflow-hidden text-sm max-h-72 overflow-y-auto">
          {matchingCategories.length > 0 && (
            <div className="border-b py-1">
              {matchingCategories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onCategorySelect(c.id);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50"
                >
                  <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">Category:</span>
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="py-1">
            {SCOPE_OPTIONS.map(({ scope: s, label }) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onScopeSelect(s);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50"
              >
                <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">{label}</span>
                <span className="truncate">
                  Find &ldquo;{q}&rdquo; in {s === "all" ? "any field" : `the ${SCOPE_BADGE[s]}`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
