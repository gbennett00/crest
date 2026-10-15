"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormattedCents } from "@/components/money";
import { currentBudgetMonth, nextBudgetMonth, previousBudgetMonth } from "@/lib/ledger";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AvailablePill } from "@/components/ui/available-pill";
import { ReadyToAssignBanner } from "./ready-to-assign-banner";
import { AssignedInput } from "./assigned-input";
import {
  assignCategory,
  assignGroup,
  renameCategory,
  renameGroup,
} from "@/app/(app)/budget/actions";
import { useBudgetView, prefetchBudgetView } from "@/lib/queries/budget";
import {
  prefetchAllTransactions,
  monthToDateRange,
} from "@/lib/queries/transactions";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import { useHasMounted } from "@/lib/use-has-mounted";
import { TargetButton } from "./target-form";
import { AssignPopup } from "./assign-popup";
import { RtaBreakdownPopup } from "./rta-breakdown-popup";
import { PaymentCategoryActivity } from "./payment-category-activity";
import { CoverOverspendingPopup } from "./cover-overspending-popup";
import { LONG_PRESS_ROW_CLASS, useRowMenu } from "./row-menu";
import { MoveMoneyPopup } from "./move-money-popup";
import { BudgetToolbar } from "./budget-toolbar";
import { MonthPicker } from "./month-picker";
import { BudgetReorder } from "./budget-reorder";
import { StickyHeader } from "@/components/ui/sticky-header";
import { LoadError } from "@/components/load-error";
import { categoryPillState } from "@/lib/budget/category-status";
import { splitLeadingEmoji } from "@/lib/leading-emoji";
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

// Columns: emoji, name, Assigned, (Activity, md+ only), Available. The last two
// are wide enough for large formatted amounts (e.g. "-$54,249.16") to stay on
// one line. Activity is hidden on small screens (hidden md:block on each
// activity cell removes it from the grid entirely there).
const COLS =
  "grid grid-cols-[26px_minmax(0,1fr)_84px_100px] md:grid-cols-[26px_minmax(0,1fr)_80px_80px_100px] gap-x-1 px-3";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const BUDGET_MONTH_RE = /^\d{4}-\d{2}-01$/;

export function BudgetScreen({ initialMonth }: { initialMonth?: string }) {
  const queryClient = useQueryClient();
  const hasMounted = useHasMounted();
  const [, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [reordering, setReordering] = useState(false);

  // Month lives in client state, not in Next's router — switching months (the
  // single most frequent interaction on this screen) reads straight from the
  // query cache instead of round-tripping through a Server Component. The
  // URL is kept in sync via the plain history API (below) so the address bar,
  // back/forward, and shared links keep working.
  const [month, setMonth] = useState(initialMonth ?? currentBudgetMonth());

  function monthHref(m: string) {
    return `/budget?month=${m}`;
  }

  function navigate(m: string) {
    if (m === month) return;
    window.history.pushState(null, "", monthHref(m));
    setMonth(m);
  }

  // Browser back/forward moves the URL without going through navigate(); sync
  // month state to match.
  useEffect(() => {
    function onPopState() {
      const params = new URLSearchParams(window.location.search);
      const urlMonth = params.get("month");
      if (urlMonth && BUDGET_MONTH_RE.test(urlMonth)) setMonth(urlMonth);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const { data: response, error, refetch } = useBudgetView(month);

  // Warm the query cache for the neighbouring months so stepping to the
  // previous/next month (and coming back) renders from cache instead of a
  // fresh network round-trip. Bounded by [minMonth, maxMonth] so we never
  // prefetch an out-of-range month.
  const prevMonth = response ? previousBudgetMonth(response.data.month) : null;
  const nextMonth = response ? nextBudgetMonth(response.data.month) : null;
  useEffect(() => {
    if (!response) return;
    if (prevMonth && prevMonth >= response.data.minMonth) {
      prefetchBudgetView(queryClient, prevMonth);
    }
    if (nextMonth && nextMonth <= response.data.maxMonth) {
      prefetchBudgetView(queryClient, nextMonth);
    }
  }, [queryClient, response, prevMonth, nextMonth]);

  // Beyond the immediate neighbours, quietly warm roughly a year of budget
  // history in the background (closest months first), throttled so it never
  // competes with a foreground navigation for the same DB connection. This is
  // the "YNAB caches your whole history on open" idea, scoped to the one
  // screen where jumping to an arbitrary month (via the month picker) is
  // common enough that a bare ±1 prefetch isn't enough — runs once per mount,
  // not on every month change.
  const didWarmHistory = useRef(false);
  useEffect(() => {
    if (didWarmHistory.current || !response) return;
    didWarmHistory.current = true;
    const { minMonth, maxMonth } = response.data;
    let cancelled = false;
    (async () => {
      let back = month;
      let fwd = month;
      for (let i = 0; i < 11 && !cancelled; i++) {
        back = previousBudgetMonth(back);
        if (back < minMonth) break;
        await prefetchBudgetView(queryClient, back);
        await new Promise((r) => setTimeout(r, 150));
      }
      for (let i = 0; i < 2 && !cancelled; i++) {
        fwd = nextBudgetMonth(fwd);
        if (fwd > maxMonth) break;
        await prefetchBudgetView(queryClient, fwd);
        await new Promise((r) => setTimeout(r, 150));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately runs once (guarded by the ref) — `month`/`response` are
    // read at that first run, not re-triggered as they change afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  // On mobile, group-budgeted groups have nothing useful in their member rows
  // (per-category assigned/available are "—" and the Activity column is hidden),
  // so collapse them by default. Done once after mount to avoid a hydration
  // mismatch; users can still expand them.
  const didInitCollapse = useRef(false);
  useEffect(() => {
    if (didInitCollapse.current || !response) return;
    didInitCollapse.current = true;
    if (window.matchMedia("(max-width: 767px)").matches) {
      setCollapsed(
        new Set(
          response.data.groups.filter((g) => g.budgetMode === "group").map((g) => g.id),
        ),
      );
    }
  }, [response]);

  function toggle(groupId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) { next.delete(groupId); } else { next.add(groupId); }
      return next;
    });
  }

  if (hasMounted && !response && error) {
    return <LoadError what="budget" error={error} onRetry={() => refetch()} />;
  }
  if (!hasMounted || !response) {
    return <BudgetSkeleton />;
  }

  const { data } = response;

  const displayGroups = data.groups.filter(
    (g) =>
      g.categories.length === 0 ||
      g.categories.some((c) => c.role !== "ready_to_assign" && !c.isHidden),
  );

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
      <StickyHeader className="flex h-[52px] shrink-0 items-center px-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(previousBudgetMonth(data.month))}
          disabled={data.month <= data.minMonth}
          className="rounded-pill text-ink-muted"
          aria-label="Previous month"
        >
          <ChevronLeft size={24} strokeWidth={1.75} />
        </Button>
        <div className="flex flex-1 justify-center">
          <MonthPicker
            month={data.month}
            minMonth={data.minMonth}
            maxMonth={data.maxMonth}
            onSelect={navigate}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(nextBudgetMonth(data.month))}
          disabled={data.month >= data.maxMonth}
          className="rounded-pill text-ink-muted"
          aria-label="Next month"
        >
          <ChevronRight size={24} strokeWidth={1.75} />
        </Button>
        <BudgetToolbar
          groups={groupOptions}
          data={data}
          reordering={reordering}
          onToggleReorder={() => setReordering((r) => !r)}
          onShowBreakdown={() => setBreakdownOpen(true)}
        />
      </StickyHeader>

      {reordering ? (
        <BudgetReorder groups={displayGroups} />
      ) : (
        <>
          {/* Ready to Assign: opens the assign popup. The breakdown lives in the
              toolbar menu. */}
          <ReadyToAssignBanner
            cents={data.rtaAvailableCents}
            onPress={() => setAssignOpen(true)}
            className="mx-3 mb-3 mt-1 w-auto"
          />

          {/* Column headers */}
          <div
            className={cn(COLS, "h-8 items-center text-overline uppercase text-ink-muted")}
          >
            <span className="col-span-2">Category</span>
            <span className="text-right">Assigned</span>
            <span className="hidden text-right md:block">Activity</span>
            <span className="pr-2.5 text-right">Available</span>
          </div>

          {/* Groups: edge to edge, no gaps or cards. */}
          {displayGroups.length === 0 ? (
            <p className="py-16 text-center text-ink-muted">
              No categories yet. Use the ⋯ menu to add one.
            </p>
          ) : (
            <div className="bg-surface">
            {displayGroups.map((group) => {
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
                        // Changes RTA everywhere and later months' available.
                        invalidateAllLedgerQueries(queryClient);
                      })
                    }
                  />

                  {isExpanded &&
                    visibleCats.map((cat, index) => (
                      <CategoryRow
                        key={cat.id}
                        isFirst={index === 0}
                        data={data}
                        cat={cat}
                        group={group}
                        month={data.month}
                        onAssign={(cents) =>
                          startTransition(async () => {
                            await assignCategory(cat.id, data.month, cents);
                            // Changes RTA everywhere and later months' available.
                            invalidateAllLedgerQueries(queryClient);
                          })
                        }
                      />
                    ))}
                </div>
              );
            })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Shown only when a month is navigated to before its query-cache prefetch
// lands (e.g. jumping via the month picker rather than stepping prev/next).
function BudgetSkeleton() {
  return (
    <div className="animate-pulse p-4 space-y-3">
      <div className="h-11 bg-muted rounded" />
      <div className="h-20 bg-muted rounded-lg" />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 bg-muted rounded" />
        ))}
      </div>
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
  const [moveOpen, setMoveOpen] = useState(false);
  const router = useRouter();
  const isGroupBudget = group.budgetMode === "group";
  const overspent = isGroupBudget && available < 0;
  const rowMenu = useRowMenu({
    onRename: () => setRenaming(true),
    onEditTarget: isGroupBudget ? () => setTargetOpen(true) : undefined,
    onMoveMoney: isGroupBudget ? () => setMoveOpen(true) : undefined,
    onViewMoves: isGroupBudget
      ? () => router.push(`/budget/moves?group=${group.id}&month=${data.month}`)
      : undefined,
    hasTarget: !!group.target,
    disabled: renaming,
  });

  return (
    <div
      {...rowMenu.rowProps}
      onClick={() => { if (!renaming) onToggle(); }}
      className={cn(
        COLS,
        LONG_PRESS_ROW_CLASS,
        "h-12 cursor-pointer items-center bg-surface-sunken transition-colors",
      )}
    >
      <span className="flex justify-center text-ink-muted">
        {isExpanded ? (
          <ChevronDown size={20} strokeWidth={1.75} />
        ) : (
          <ChevronRight size={20} strokeWidth={1.75} />
        )}
      </span>
      <div className="flex min-w-0 items-center gap-1.5 text-headline">
        <InlineName
          id={group.id}
          name={group.name}
          type="group"
          editing={renaming}
          onDone={() => setRenaming(false)}
        />
        {rowMenu.menu}
        {moveOpen && (
          <span onClick={(e) => e.stopPropagation()}>
            <MoveMoneyPopup
              data={data}
              unit={{ type: "group", id: group.id }}
              onClose={() => setMoveOpen(false)}
            />
          </span>
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
          <AssignedInput value={assigned} onSave={onAssignGroup} label={group.name} />
        </div>
      ) : (
        <span className="num whitespace-nowrap text-right text-amount-sm">
          {formatCents(assigned)}
        </span>
      )}

      <span className="num hidden whitespace-nowrap text-right text-amount-sm text-ink-muted md:block">
        {formatCents(activity)}
      </span>
      {overspent ? (
        <span className="relative block pr-2.5 text-right" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setCoverOpen(true)}
            className="num whitespace-nowrap text-right text-amount-sm text-neg-text hover:underline"
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
                overspentCents: available,
              }}
              onClose={() => setCoverOpen(false)}
            />
          )}
        </span>
      ) : (
        <span className="num whitespace-nowrap pr-2.5 text-right text-amount-sm">
          {formatCents(available)}
        </span>
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
  isFirst,
}: {
  isFirst: boolean;
  data: BudgetData;
  cat: BudgetCategory;
  group: BudgetGroup;
  month: string;
  onAssign: (cents: number) => void;
}) {
  const formatCents = useFormattedCents();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const isCategoryBudget = group.budgetMode === "category";
  const isCC = cat.cardRegisterBalanceCents !== null;
  const { emoji, label } = splitLeadingEmoji(cat.name);
  const pillState = categoryPillState(cat, month);
  const overspent = isCategoryBudget && cat.availableCents < 0;
  // The Sinking Fund's target is derived from every sinking target (see
  // deriveSinkingFundTarget), so it isn't editable here.
  const canEditTarget = isCategoryBudget && cat.role !== "sinking_fund";

  function handleRowClick() {
    if (renaming) return;
    if (isCC) setCcOpen((o) => !o);
    else {
      router.push(`/budget/category/${cat.id}?month=${month}`);
    }
  }

  // Warms the query cache before the click lands, so the transactions page
  // (a separate route) also renders instantly.
  function handlePrefetch() {
    if (!isCC) {
      const { dateFrom, dateTo } = monthToDateRange(month);
      prefetchAllTransactions(queryClient, { categoryId: cat.id, dateFrom, dateTo });
    }
  }

  const rowMenu = useRowMenu({
    onRename: () => setRenaming(true),
    onEditTarget: canEditTarget ? () => setTargetOpen(true) : undefined,
    onMoveMoney: isCategoryBudget ? () => setMoveOpen(true) : undefined,
    onViewMoves: isCategoryBudget
      ? () => router.push(`/budget/moves?category=${cat.id}&month=${month}`)
      : undefined,
    hasTarget: !!cat.target,
    disabled: renaming,
  });

  return (
    <div
      role="button"
      tabIndex={0}
      {...rowMenu.rowProps}
      onClick={handleRowClick}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
      onPointerDown={(e) => {
        rowMenu.rowProps.onPointerDown(e);
        handlePrefetch();
      }}
      className={cn(
        COLS,
        LONG_PRESS_ROW_CLASS,
        "min-h-row-dense cursor-pointer items-center py-1 transition-colors",
        !isFirst && "border-t",
        // Editing is shown by the row tint, not by a box around the value.
        editing ? "bg-brand-subtle" : "hover:bg-surface-sunken",
      )}
    >
      <span aria-hidden="true" className="text-center text-xl leading-6">
        {emoji}
      </span>
      <span className="flex min-w-0 items-center gap-1 pl-1 text-row-label">
        <InlineName
          id={cat.id}
          name={cat.name}
          displayName={label}
          type="category"
          editing={renaming}
          onDone={() => setRenaming(false)}
        />
        {rowMenu.menu}
        {moveOpen && (
          <span onClick={(e) => e.stopPropagation()}>
            <MoveMoneyPopup
              data={data}
              unit={{ type: "category", id: cat.id }}
              onClose={() => setMoveOpen(false)}
            />
          </span>
        )}
        {canEditTarget && (
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
          <AssignedInput
            value={cat.assignedCents}
            onSave={onAssign}
            label={label}
            onEditingChange={setEditing}
            quickActions={[
              {
                label: "Move money",
                icon: <ArrowLeftRight />,
                onSelect: () => setMoveOpen(true),
              },
              {
                label: "Details",
                icon: <MoreHorizontal />,
                onSelect: () => router.push(`/budget/category/${cat.id}?month=${month}`),
              },
            ]}
          />
        </div>
      ) : (
        <span className="text-right text-ink-muted">—</span>
      )}

      <span className="num hidden whitespace-nowrap text-right text-ink-muted md:block">
        {cat.activityCents !== 0 || isCC ? formatCents(cat.activityCents) : "—"}
      </span>

      {isCategoryBudget ? (
        <span className="relative flex justify-end">
          {overspent ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setCoverOpen(true); }}
              aria-label={`${label} is overspent. Cover overspending`}
              className="rounded-pill"
            >
              <AvailablePill cents={cat.availableCents} state={pillState} />
            </button>
          ) : (
            <AvailablePill cents={cat.availableCents} state={pillState} />
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
                  overspentCents: cat.availableCents,
                }}
                onClose={() => setCoverOpen(false)}
              />
            </span>
          )}
        </span>
      ) : (
        <span className="text-right text-ink-muted">—</span>
      )}
    </div>
  );
}

// Inline rename field shared by group/category rows. When not editing it renders
// the name as plain text so the row's click handler (navigate / toggle) works.
function InlineName({
  id,
  name,
  displayName,
  type,
  editing,
  onDone,
}: {
  id: string;
  name: string;
  /** What to show when not editing (e.g. the name without its leading emoji).
   * Renaming always edits the full `name`. */
  displayName?: string;
  type: "category" | "group";
  editing: boolean;
  onDone: () => void;
}) {
  const [, startTransition] = useTransition();
  const queryClient = useQueryClient();

  if (!editing) {
    return <span className="min-w-0 truncate">{displayName ?? name}</span>;
  }

  function commit(value: string) {
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) {
      startTransition(async () => {
        if (type === "category") await renameCategory(id, trimmed);
        else await renameGroup(id, trimmed);
        invalidateAllLedgerQueries(queryClient);
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
      className="h-6 md:text-sm py-0 px-1.5"
    />
  );
}
