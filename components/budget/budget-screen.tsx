"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Info } from "lucide-react";
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
import { RtaBreakdownPopup } from "./rta-breakdown-popup";
import { PaymentCategoryActivity } from "./payment-category-activity";
import { CoverOverspendingPopup } from "./cover-overspending-popup";
import { RowMenu } from "./row-menu";
import { BudgetToolbar } from "./budget-toolbar";
import { MonthPicker } from "./month-picker";
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
  const [breakdownOpen, setBreakdownOpen] = useState(false);
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

  function monthHref(month: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", month);
    return `/budget?${params.toString()}`;
  }

  function navigate(month: string) {
    router.push(monthHref(month));
  }

  // Warm the Router Cache for the neighbouring months so stepping to the
  // previous/next month renders from cache instead of a fresh ~1s server load.
  // Bounded by [minMonth, maxMonth] so we never prefetch an out-of-range month.
  const prevMonth = previousBudgetMonth(data.month);
  const nextMonth = nextBudgetMonth(data.month);
  useEffect(() => {
    if (prevMonth >= data.minMonth) router.prefetch(monthHref(prevMonth));
    if (nextMonth <= data.maxMonth) router.prefetch(monthHref(nextMonth));
    // monthHref reads live searchParams; prevMonth/nextMonth capture the month.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, prevMonth, nextMonth, data.minMonth, data.maxMonth]);

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

  // RTA is a single global figure (the same on every month, matching YNAB): show
  // the full banner whenever there's something to act on — money to assign or an
  // over-assignment — and fall back to a slim, always-present pill at $0, so the
  // breakdown is reachable anytime including the "all money assigned" state.
  const showRtaBanner = data.rtaAvailableCents !== 0;

  const groupOptions = displayGroups.map((g) => ({ id: g.id, name: g.name }));

  return (
    <div className="flex flex-col">
      {assignOpen && (
        <AssignPopup data={data} onClose={() => setAssignOpen(false)} />
      )}
      {breakdownOpen && (
        <RtaBreakdownPopup data={data} onClose={() => setBreakdownOpen(false)} />
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
        <MonthPicker
          month={data.month}
          minMonth={data.minMonth}
          maxMonth={data.maxMonth}
          onSelect={navigate}
        />
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
          {/* Ready to Assign — full banner when there's something to act on,
              otherwise a slim pill so the breakdown stays reachable (e.g. at
              $0). In both, the amount opens the assign popup and the info button
              opens the read-only breakdown. */}
          {showRtaBanner ? (
            <RtaBanner
              cents={data.rtaAvailableCents}
              onAssign={() => setAssignOpen(true)}
              onBreakdown={() => setBreakdownOpen(true)}
            />
          ) : (
            <RtaPill
              cents={data.rtaAvailableCents}
              onAssign={() => setAssignOpen(true)}
              onBreakdown={() => setBreakdownOpen(true)}
            />
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
                    data={data}
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
                        data={data}
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
  data,
  group,
  isExpanded,
  onToggle,
  assigned,
  activity,
  available,
  onAssignGroup,
}: {
  data: BudgetData;
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
  const [coverOpen, setCoverOpen] = useState(false);
  const isGroupBudget = group.budgetMode === "group";
  const overspent = isGroupBudget && available < 0;

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
      {overspent ? (
        <span className="relative block text-right" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setCoverOpen(true)}
            className="text-right font-medium tabular-nums text-destructive hover:underline"
          >
            {formatCents(available)}
          </button>
          {coverOpen && (
            <CoverOverspendingPopup
              data={data}
              target={{
                type: "group",
                id: group.id,
                name: group.name,
                originalAssigned: group.groupAssignedCents,
                overspentCents: available,
              }}
              onClose={() => setCoverOpen(false)}
            />
          )}
        </span>
      ) : (
        <AvailableCell cents={available} />
      )}
    </div>
  );
}

function CategoryRow({
  data,
  cat,
  group,
  month,
  onAssign,
}: {
  data: BudgetData;
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
  const [coverOpen, setCoverOpen] = useState(false);

  const isCategoryBudget = group.budgetMode === "category";
  const isCC = cat.cardRegisterBalanceCents !== null;
  const underfunded =
    isCC && paymentShortfallCents(cat.availableCents, cat.cardRegisterBalanceCents) > 0;
  const overspent = isCategoryBudget && cat.availableCents < 0;

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
          {overspent ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setCoverOpen(true); }}
              className="text-right font-medium tabular-nums text-destructive hover:underline"
            >
              {formatCents(cat.availableCents)}
            </button>
          ) : (
            <AvailableCell cents={cat.availableCents} />
          )}
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
          {coverOpen && (
            <span onClick={(e) => e.stopPropagation()}>
              <CoverOverspendingPopup
                data={data}
                target={{
                  type: "category",
                  id: cat.id,
                  name: cat.name,
                  originalAssigned: cat.assignedCents,
                  overspentCents: cat.availableCents,
                }}
                onClose={() => setCoverOpen(false)}
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

function RtaBanner({
  cents,
  onAssign,
  onBreakdown,
}: {
  cents: number;
  onAssign: () => void;
  onBreakdown: () => void;
}) {
  const formatCents = useFormattedCents();
  const overAssigned = cents < 0;
  return (
    <div
      className={cn(
        "mx-4 mt-4 mb-3 rounded-lg px-4 py-3 flex items-center justify-between",
        overAssigned
          ? "bg-destructive/10 border border-destructive/30"
          : "bg-primary/10 border border-primary/30",
      )}
    >
      <button
        className="text-left flex-1 min-w-0 cursor-pointer hover:opacity-90 transition-opacity"
        onClick={onAssign}
      >
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
      </button>
      <div className="flex items-center gap-2 shrink-0 pl-3">
        {overAssigned && (
          <span className="text-xs font-semibold text-destructive">Over-assigned</span>
        )}
        <button
          onClick={onBreakdown}
          aria-label="Ready to Assign breakdown"
          className={cn(
            "p-1.5 rounded-full hover:bg-foreground/5 transition-colors",
            overAssigned ? "text-destructive" : "text-primary",
          )}
        >
          <Info size={18} />
        </button>
      </div>
    </div>
  );
}

// Compact, always-present stand-in for the RTA banner when there's nothing to
// act on (notably the "all money assigned" $0 state). Keeps the breakdown one
// tap away. Same interaction split as the banner: label/amount opens the assign
// popup, the info button opens the breakdown.
function RtaPill({
  cents,
  onAssign,
  onBreakdown,
}: {
  cents: number;
  onAssign: () => void;
  onBreakdown: () => void;
}) {
  const formatCents = useFormattedCents();
  const allAssigned = cents === 0;
  return (
    <div className="mx-4 mt-3 mb-2 flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-1.5">
      <button
        onClick={onAssign}
        className="flex items-center gap-1.5 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
      >
        {allAssigned && <Check size={14} className="text-primary shrink-0" />}
        <span className="text-xs font-medium text-muted-foreground truncate">
          {allAssigned ? "All money assigned" : "Ready to Assign"}
        </span>
        <span className="text-xs font-semibold tabular-nums">{formatCents(cents)}</span>
      </button>
      <button
        onClick={onBreakdown}
        aria-label="Ready to Assign breakdown"
        className="p-1 rounded-full text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors shrink-0"
      >
        <Info size={15} />
      </button>
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
