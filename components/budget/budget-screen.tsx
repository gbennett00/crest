"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormattedCents } from "@/components/money";
import { nextBudgetMonth, previousBudgetMonth } from "@/lib/ledger";
import { Input } from "@/components/ui/input";
import { AssignedInput } from "./assigned-input";
import {
  assignCategory,
  assignGroup,
  renameCategory,
  renameGroup,
} from "@/app/(app)/budget/actions";
import { TargetButton } from "./target-form";
import { AssignPopup } from "./assign-popup";
import { PaymentCategoryActivity } from "./payment-category-activity";
import { RowMenu } from "./row-menu";
import { BudgetToolbar } from "./budget-toolbar";
import { BudgetReorder } from "./budget-reorder";
import { paymentShortfallCents } from "@/lib/budget/compute";
import type {
  BudgetCategory,
  BudgetData,
  BudgetGroup,
  TargetData,
} from "@/lib/budget/types";

// View-model types live in @/lib/budget/types so server data-loaders and client
// components can share them without crossing the server/client boundary.
// Re-exported here for the existing import sites that reference them via this module.
export type { BudgetCategory, BudgetData, BudgetGroup, TargetData };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMonth(month: string): string {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// Activity is the 3rd column and is hidden on small screens (hidden md:block on
// each activity cell removes it from the grid entirely there).
const COLS = "grid grid-cols-[1fr_68px_76px] md:grid-cols-[1fr_68px_68px_76px]";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BudgetScreen({ data }: { data: BudgetData }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [reordering, setReordering] = useState(false);

  // On mobile, group-budgeted groups have nothing useful in their member rows
  // (per-category assigned/available are "—" and the Activity column is hidden),
  // so collapse them by default. Done once after mount to avoid a hydration
  // mismatch; users can still expand them.
  const didInitCollapse = useRef(false);
  useEffect(() => {
    if (didInitCollapse.current) return;
    didInitCollapse.current = true;
    if (window.matchMedia("(max-width: 767px)").matches) {
      setCollapsed(
        new Set(
          data.groups.filter((g) => g.budgetMode === "group").map((g) => g.id),
        ),
      );
    }
  }, [data.groups]);

  function navigate(month: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", month);
    router.push(`/budget?${params.toString()}`);
  }

  function toggle(groupId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) { next.delete(groupId); } else { next.add(groupId); }
      return next;
    });
  }

  const displayGroups = data.groups.filter(
    (g) =>
      g.categories.length === 0 ||
      g.categories.some((c) => c.role !== "ready_to_assign" && !c.isHidden),
  );

  // RTA banner visibility (matches YNAB). maxMonth is next month, so two steps
  // back is the previous month — the start of the prev/current/next "live"
  // window. Inside that window we show any non-zero RTA; older months only
  // surface it when over-assigned (a positive leftover has rolled forward).
  const liveWindowStart = previousBudgetMonth(previousBudgetMonth(data.maxMonth));
  const showRta =
    data.month >= liveWindowStart
      ? data.rtaAvailableCents !== 0
      : data.rtaAvailableCents < 0;

  const groupOptions = displayGroups.map((g) => ({ id: g.id, name: g.name }));

  return (
    <div className="flex flex-col">
      {assignOpen && (
        <AssignPopup data={data} onClose={() => setAssignOpen(false)} />
      )}

      {/* Month navigation — sticky directly under the global header. */}
      <div className="sticky top-0 z-10 bg-background border-b flex items-center justify-between px-2 h-11 shrink-0">
        <button
          onClick={() => navigate(previousBudgetMonth(data.month))}
          disabled={data.month <= data.minMonth}
          className="p-2 rounded hover:bg-accent transition-colors text-muted-foreground disabled:opacity-30 disabled:pointer-events-none"
          aria-label="Previous month"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="font-semibold text-sm">{formatMonth(data.month)}</span>
        <div className="flex items-center">
          <button
            onClick={() => navigate(nextBudgetMonth(data.month))}
            disabled={data.month >= data.maxMonth}
            className="p-2 rounded hover:bg-accent transition-colors text-muted-foreground disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
          <BudgetToolbar
            groups={groupOptions}
            reordering={reordering}
            onToggleReorder={() => setReordering((r) => !r)}
          />
        </div>
      </div>

      {reordering ? (
        <BudgetReorder groups={displayGroups} />
      ) : (
        <>
          {/* Ready to Assign banner — clickable to open assign popup. */}
          {showRta && (
            <button className="text-left w-full" onClick={() => setAssignOpen(true)}>
              <RtaBanner cents={data.rtaAvailableCents} />
            </button>
          )}

          {/* Column headers */}
          <div
            className={cn(
              COLS,
              "px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b",
            )}
          >
            <span>Category</span>
            <span className="text-right">Assigned</span>
            <span className="hidden md:block text-right">Activity</span>
            <span className="text-right">Available</span>
          </div>

          {/* Groups */}
          {displayGroups.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-16">
              No categories yet. Use the + button to add one.
            </p>
          ) : (
            displayGroups.map((group) => {
              const isExpanded = !collapsed.has(group.id);
              const visibleCats = group.categories.filter(
                (c) => c.role !== "ready_to_assign" && !c.isHidden,
              );

              const totalAssigned =
                group.budgetMode === "group"
                  ? group.groupAssignedCents
                  : visibleCats.reduce((s, c) => s + c.assignedCents, 0);
              const totalActivity =
                group.budgetMode === "group"
                  ? group.groupActivityCents
                  : visibleCats.reduce((s, c) => s + c.activityCents, 0);
              const totalAvailable =
                group.budgetMode === "group"
                  ? group.groupAvailableCents
                  : visibleCats.reduce((s, c) => s + c.availableCents, 0);

              return (
                <div key={group.id}>
                  <GroupHeaderRow
                    group={group}
                    isExpanded={isExpanded}
                    onToggle={() => toggle(group.id)}
                    assigned={totalAssigned}
                    activity={totalActivity}
                    available={totalAvailable}
                    onAssignGroup={(cents) =>
                      startTransition(async () => {
                        await assignGroup(group.id, data.month, cents);
                      })
                    }
                  />

                  {isExpanded &&
                    visibleCats.map((cat) => (
                      <CategoryRow
                        key={cat.id}
                        cat={cat}
                        group={group}
                        month={data.month}
                        onAssign={(cents) =>
                          startTransition(async () => {
                            await assignCategory(cat.id, data.month, cents);
                          })
                        }
                      />
                    ))}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function GroupHeaderRow({
  group,
  isExpanded,
  onToggle,
  assigned,
  activity,
  available,
  onAssignGroup,
}: {
  group: BudgetGroup;
  isExpanded: boolean;
  onToggle: () => void;
  assigned: number;
  activity: number;
  available: number;
  onAssignGroup: (cents: number) => void;
}) {
  const formatCents = useFormattedCents();
  const [renaming, setRenaming] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const isGroupBudget = group.budgetMode === "group";

  return (
    <div
      onClick={() => { if (!renaming) onToggle(); }}
      className={cn(
        COLS,
        "px-4 py-2 border-b bg-primary/5 hover:bg-primary/10 text-sm font-medium items-center cursor-pointer transition-colors",
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="shrink-0 text-muted-foreground">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <InlineName
          id={group.id}
          name={group.name}
          type="group"
          editing={renaming}
          onDone={() => setRenaming(false)}
        />
        {!renaming && (
          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            <RowMenu
              onRename={() => setRenaming(true)}
              onEditTarget={isGroupBudget ? () => setTargetOpen(true) : undefined}
              hasTarget={!!group.target}
              showTarget={isGroupBudget}
            />
          </div>
        )}
        {isGroupBudget && (
          <span onClick={(e) => e.stopPropagation()}>
            <TargetButton
              entityId={group.id}
              entityType="group"
              existingTarget={group.target}
              open={targetOpen}
              onOpenChange={setTargetOpen}
              showTrigger={false}
            />
          </span>
        )}
      </div>

      {isGroupBudget ? (
        <div onClick={(e) => e.stopPropagation()}>
          <AssignedInput value={assigned} onSave={onAssignGroup} />
        </div>
      ) : (
        <span className="text-right">{formatCents(assigned)}</span>
      )}

      <span className="hidden md:block text-right text-muted-foreground">
        {formatCents(activity)}
      </span>
      <AvailableCell cents={available} />
    </div>
  );
}

function CategoryRow({
  cat,
  group,
  month,
  onAssign,
}: {
  cat: BudgetCategory;
  group: BudgetGroup;
  month: string;
  onAssign: (cents: number) => void;
}) {
  const formatCents = useFormattedCents();
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);

  const isCategoryBudget = group.budgetMode === "category";
  const isCC = cat.cardRegisterBalanceCents !== null;
  const underfunded =
    isCC && paymentShortfallCents(cat.availableCents, cat.cardRegisterBalanceCents) > 0;

  function handleRowClick() {
    if (renaming) return;
    if (isCC) setCcOpen((o) => !o);
    else router.push(`/transactions?category=${cat.id}&month=${month}`);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleRowClick}
      className={cn(
        COLS,
        "px-4 pl-8 py-2 border-b text-sm items-center cursor-pointer hover:bg-accent/40 transition-colors",
      )}
    >
      <span className="flex items-center gap-1 min-w-0">
        <InlineName
          id={cat.id}
          name={cat.name}
          type="category"
          editing={renaming}
          onDone={() => setRenaming(false)}
        />
        {!renaming && (
          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            <RowMenu
              onRename={() => setRenaming(true)}
              onEditTarget={isCategoryBudget ? () => setTargetOpen(true) : undefined}
              hasTarget={!!cat.target}
              showTarget={isCategoryBudget}
            />
          </div>
        )}
        {isCategoryBudget && (
          <span onClick={(e) => e.stopPropagation()}>
            <TargetButton
              entityId={cat.id}
              entityType="category"
              existingTarget={cat.target}
              open={targetOpen}
              onOpenChange={setTargetOpen}
              showTrigger={false}
            />
          </span>
        )}
      </span>

      {isCategoryBudget ? (
        <div onClick={(e) => e.stopPropagation()}>
          <AssignedInput value={cat.assignedCents} onSave={onAssign} />
        </div>
      ) : (
        <span className="text-right text-muted-foreground text-xs">—</span>
      )}

      <span className="hidden md:block text-right text-muted-foreground">
        {isCC ? (
          <span
            className={cn(
              "tabular-nums",
              underfunded && "text-amber-600 dark:text-amber-400",
            )}
          >
            {formatCents(cat.activityCents)}
          </span>
        ) : cat.activityCents !== 0 ? (
          formatCents(cat.activityCents)
        ) : (
          <span className="text-xs">—</span>
        )}
      </span>

      {isCategoryBudget ? (
        <span className="relative block text-right">
          <AvailableCell cents={cat.availableCents} />
          {isCC && (
            <span onClick={(e) => e.stopPropagation()}>
              <PaymentCategoryActivity
                cat={cat}
                month={month}
                open={ccOpen}
                onOpenChange={setCcOpen}
                showTrigger={false}
              />
            </span>
          )}
        </span>
      ) : (
        <span className="text-right text-muted-foreground text-xs">—</span>
      )}
    </div>
  );
}

// Inline rename field shared by group/category rows. When not editing it renders
// the name as plain text so the row's click handler (navigate / toggle) works.
function InlineName({
  id,
  name,
  type,
  editing,
  onDone,
}: {
  id: string;
  name: string;
  type: "category" | "group";
  editing: boolean;
  onDone: () => void;
}) {
  const [, startTransition] = useTransition();

  if (!editing) {
    return <span className="truncate min-w-0">{name}</span>;
  }

  function commit(value: string) {
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) {
      startTransition(async () => {
        if (type === "category") await renameCategory(id, trimmed);
        else await renameGroup(id, trimmed);
        onDone();
      });
    } else {
      onDone();
    }
  }

  return (
    <Input
      autoFocus
      defaultValue={name}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => {
        const len = e.target.value.length;
        e.target.setSelectionRange(len, len);
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit((e.target as HTMLInputElement).value);
        }
        if (e.key === "Escape") onDone();
      }}
      // text-base on mobile (16px) prevents iOS zoom-on-focus.
      className="h-6 text-base md:text-sm py-0 px-1.5"
    />
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RtaBanner({ cents }: { cents: number }) {
  const formatCents = useFormattedCents();
  const overAssigned = cents < 0;
  return (
    <div
      className={cn(
        "mx-4 mt-4 mb-3 rounded-lg px-4 py-3 flex items-center justify-between cursor-pointer hover:opacity-90 transition-opacity",
        overAssigned
          ? "bg-destructive/10 border border-destructive/30"
          : "bg-primary/10 border border-primary/30",
      )}
    >
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Ready to Assign
        </p>
        <p
          className={cn(
            "text-2xl font-bold tabular-nums mt-0.5",
            overAssigned ? "text-destructive" : "text-primary",
          )}
        >
          {formatCents(cents)}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {overAssigned && (
          <span className="text-xs font-semibold text-destructive">Over-assigned</span>
        )}
        <ChevronRight size={18} className={overAssigned ? "text-destructive" : "text-primary"} />
      </div>
    </div>
  );
}

function AvailableCell({ cents }: { cents: number }) {
  const formatCents = useFormattedCents();
  return (
    <span
      className={cn(
        "text-right font-medium tabular-nums",
        cents < 0
          ? "text-destructive"
          : cents === 0
            ? "text-muted-foreground"
            : "text-foreground",
      )}
    >
      {formatCents(cents)}
    </span>
  );
}
