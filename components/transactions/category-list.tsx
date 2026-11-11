"use client";

import { useImperativeHandle, useMemo, useRef } from "react";
import { Check, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { splitLeadingEmoji } from "@/lib/leading-emoji";
import { groupCategories, splitMatch } from "@/lib/category-search";
import type { CategoryOption } from "./transaction-form";

/**
 * The grouped, searchable category list shared by `CategoryPicker` and the
 * Home approve drawer. Groups come in the order `categories` is given (Plan
 * order) under sticky `surface-sunken` headers; `query` filters by category
 * or group name and highlights the match. Optional leading sections:
 * `suggestedIds` ("Suggested", hidden while searching) and `noneLabel`.
 * Render it inside a scroll container; it has no scrolling of its own.
 */
export function CategoryList({
  categories,
  value,
  onSelect,
  query = "",
  suggestedIds,
  noneLabel,
  selectedIds,
}: {
  categories: CategoryOption[];
  value: string | null;
  onSelect: (categoryId: string) => void;
  query?: string;
  suggestedIds?: string[];
  noneLabel?: string;
  /** Multi-select: rows show a checkbox, checked for these ids (`value` is ignored). */
  selectedIds?: ReadonlySet<string>;
}) {
  const isSelected = (id: string) => (selectedIds ? selectedIds.has(id) : id === value);
  const checkbox = !!selectedIds;
  const searching = query.trim() !== "";
  const groups = useMemo(() => groupCategories(categories, query), [categories, query]);
  const suggested = useMemo(() => {
    if (searching || !suggestedIds?.length) return [];
    const byId = new Map(categories.map((c) => [c.id, c]));
    return suggestedIds.map((id) => byId.get(id)).filter((c): c is CategoryOption => !!c);
  }, [categories, suggestedIds, searching]);

  return (
    <div>
      {noneLabel && !searching && (
        <CategoryRow label={noneLabel} muted selected={!value} onClick={() => onSelect("")} />
      )}

      {suggested.length > 0 && (
        <Group title="Suggested">
          {suggested.map((c) => (
            <CategoryRow
              key={c.id}
              label={c.name}
              selected={isSelected(c.id)}
              checkbox={checkbox}
              onClick={() => onSelect(c.id)}
            />
          ))}
        </Group>
      )}

      {groups.length === 0 && (
        <p className="py-10 text-center text-body text-ink-muted">No categories found.</p>
      )}

      {groups.map(([groupName, cats]) => (
        <Group key={groupName} title={groupName}>
          {cats.map((c) => (
            <CategoryRow
              key={c.id}
              label={c.name}
              query={query}
              selected={isSelected(c.id)}
              checkbox={checkbox}
              onClick={() => onSelect(c.id)}
            />
          ))}
        </Group>
      ))}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="sticky top-0 z-10 border-y bg-surface-sunken px-4 py-1.5 text-overline uppercase text-ink-muted">
        {title}
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

/**
 * One category choice: emoji column, name (with the search match
 * highlighted), a check when selected. `list` is an edge-to-edge row with a
 * hairline (the grouped list); `card` is a bordered, rounded tile (the
 * approve drawer's suggestions).
 */
export function CategoryRow({
  label,
  query = "",
  selected,
  muted,
  variant = "list",
  checkbox,
  onClick,
}: {
  label: string;
  query?: string;
  selected: boolean;
  muted?: boolean;
  variant?: "list" | "card";
  /** Multi-select: a leading checkbox instead of the trailing check. */
  checkbox?: boolean;
  onClick: () => void;
}) {
  const { emoji, label: text } = splitLeadingEmoji(label);
  const { before, match, after } = splitMatch(text, query);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={cn(
          "flex min-h-[52px] w-full items-center gap-3 text-left text-body font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          variant === "list"
            ? cn("border-b px-4 focus-visible:ring-inset", selected ? "bg-brand-subtle" : "hover:bg-surface")
            : cn(
                "rounded-ds-md border px-3.5",
                selected ? "border-brand-text bg-brand-subtle" : "border-border bg-surface hover:bg-surface-sunken",
              ),
          muted ? "text-ink-muted" : "text-ink",
        )}
      >
        {checkbox && (
          <span
            aria-hidden="true"
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-ds-sm border-2",
              selected ? "border-brand bg-brand text-brand-ink" : "border-border-strong",
            )}
          >
            {selected && <Check size={16} strokeWidth={3} />}
          </span>
        )}
        {emoji && (
          <span aria-hidden="true" className="w-[26px] shrink-0 text-center text-xl">
            {emoji}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">
          {before}
          {match && <mark className="bg-transparent font-bold text-brand-text">{match}</mark>}
          {after}
        </span>
        {selected && !checkbox && (
          <Check size={20} strokeWidth={2.25} className="shrink-0 text-brand-text" aria-hidden />
        )}
      </button>
    </li>
  );
}

/**
 * The search field above a category list: 48px, sunken, search icon, and a
 * clear button that keeps focus in the field. `inputRef` exposes the input
 * (e.g. to blur it when leaving a browse mode).
 */
export function CategorySearchField({
  value,
  onChange,
  onFocus,
  inputRef,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useImperativeHandle(inputRef, () => ref.current as HTMLInputElement, []);
  return (
    <div
      className={cn(
        "flex h-12 min-w-0 items-center gap-2.5 rounded-ds-md border border-border-strong bg-surface-sunken px-3.5 focus-within:border-focus",
        className,
      )}
    >
      <Search size={20} strokeWidth={1.75} className="shrink-0 text-ink-subtle" aria-hidden />
      <input
        ref={ref}
        value={value}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search all categories"
        aria-label="Search all categories"
        className="h-full min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-subtle focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
          aria-label="Clear search"
          className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-pill text-ink-muted hover:text-ink"
        >
          <X size={18} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
