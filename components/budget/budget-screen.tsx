"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format";
import { nextBudgetMonth, previousBudgetMonth } from "@/lib/ledger";
import { AssignedInput } from "./assigned-input";
import { assignCategory, assignGroup } from "@/app/(app)/budget/actions";
import { AddGroupForm } from "./add-group-form";
import { AddCategoryForm } from "./add-category-form";
import { TargetButton } from "./target-form";
import { AssignPopup } from "./assign-popup";

// ---------------------------------------------------------------------------
// Types (also imported by the page server component)
// ---------------------------------------------------------------------------

export type TargetData = {
  type: "fill_up_to" | "set_aside" | "by_date";
  amountCents: number;
  targetDate: string | null;
};

export type BudgetCategory = {
  id: string;
  name: string;
  role: "ready_to_assign" | null;
  isPinned: boolean;
  isHidden: boolean;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
  target: TargetData | null;
};

export type BudgetGroup = {
  id: string;
  name: string;
  budgetMode: "category" | "group";
  isPinned: boolean;
  categories: BudgetCategory[];
  groupAssignedCents: number;
  groupActivityCents: number;
  groupAvailableCents: number;
  target: TargetData | null;
};

export type BudgetData = {
  month: string;
  rtaAvailableCents: number;
  groups: BudgetGroup[];
};

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

const COLS = "grid grid-cols-[1fr_68px_68px_76px]";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BudgetScreen({ data }: { data: BudgetData }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);

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

  return (
    <div className="flex flex-col pt-12">
      {assignOpen && (
        <AssignPopup data={data} onClose={() => setAssignOpen(false)} />
      )}

      {/* Month navigation — sticky top-12 matches pt-12 on the wrapper so there's no jump on load */}
      <div className="sticky top-12 z-10 bg-background border-b flex items-center justify-between px-2 h-11 shrink-0">
        <button
          onClick={() => navigate(previousBudgetMonth(data.month))}
          className="p-2 rounded hover:bg-accent transition-colors text-muted-foreground"
          aria-label="Previous month"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="font-semibold text-sm">{formatMonth(data.month)}</span>
        <button
          onClick={() => navigate(nextBudgetMonth(data.month))}
          className="p-2 rounded hover:bg-accent transition-colors text-muted-foreground"
          aria-label="Next month"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Ready to Assign banner — clickable to open assign popup */}
      <button className="text-left w-full" onClick={() => setAssignOpen(true)}>
        <RtaBanner cents={data.rtaAvailableCents} />
      </button>

      {/* Column headers */}
      <div
        className={cn(
          COLS,
          "px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground border-b",
        )}
      >
        <span>Category</span>
        <span className="text-right">Assigned</span>
        <span className="text-right">Activity</span>
        <span className="text-right">Available</span>
      </div>

      {/* Groups */}
      {displayGroups.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-16">
          No categories yet.
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
              {/* Group header row */}
              <div
                className={cn(
                  COLS,
                  "px-4 py-2 border-b bg-muted/40 text-sm font-medium items-center",
                )}
              >
                <button
                  className="flex items-center gap-1.5 text-left min-w-0"
                  onClick={() => toggle(group.id)}
                >
                  {isExpanded ? (
                    <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{group.name}</span>
                  {group.budgetMode === "group" && (
                    <TargetButton
                      entityId={group.id}
                      entityType="group"
                      existingTarget={group.target}
                    />
                  )}
                </button>

                {group.budgetMode === "group" ? (
                  <AssignedInput
                    value={totalAssigned}
                    onSave={(cents) =>
                      startTransition(async () => {
                        await assignGroup(group.id, data.month, cents);
                      })
                    }
                  />
                ) : (
                  <span className="text-right">{formatCents(totalAssigned)}</span>
                )}

                <span className="text-right text-muted-foreground">
                  {formatCents(totalActivity)}
                </span>
                <AvailableCell cents={totalAvailable} />
              </div>

              {/* Category rows */}
              {isExpanded &&
                visibleCats.map((cat) => (
                  <div
                    key={cat.id}
                    className={cn(COLS, "px-4 pl-8 py-2 border-b text-sm items-center")}
                  >
                    <span className="flex items-center gap-1 min-w-0">
                      <span className="truncate">{cat.name}</span>
                      {group.budgetMode === "category" && (
                        <TargetButton
                          entityId={cat.id}
                          entityType="category"
                          existingTarget={cat.target}
                        />
                      )}
                    </span>

                    {group.budgetMode === "category" ? (
                      <AssignedInput
                        value={cat.assignedCents}
                        onSave={(cents) =>
                          startTransition(async () => {
                            await assignCategory(cat.id, data.month, cents);
                          })
                        }
                      />
                    ) : (
                      <span className="text-right text-muted-foreground text-xs">—</span>
                    )}

                    <span className="text-right text-muted-foreground">
                      {cat.activityCents !== 0 ? (
                        <Link
                          href={`/transactions?category=${cat.id}&month=${data.month}`}
                          className="hover:underline"
                        >
                          {formatCents(cat.activityCents)}
                        </Link>
                      ) : (
                        <span className="text-xs">—</span>
                      )}
                    </span>

                    {group.budgetMode === "category" ? (
                      <AvailableCell cents={cat.availableCents} />
                    ) : (
                      <span className="text-right text-muted-foreground text-xs">—</span>
                    )}
                  </div>
                ))}

              {/* Add category form (shown when group is expanded) */}
              {isExpanded && <AddCategoryForm groupId={group.id} />}
            </div>
          );
        })
      )}

      {/* Add group form at the bottom */}
      <AddGroupForm />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RtaBanner({ cents }: { cents: number }) {
  const overAssigned = cents < 0;
  return (
    <div
      className={cn(
        "mx-4 mt-4 mb-3 rounded-lg px-4 py-3 flex items-center justify-between cursor-pointer hover:opacity-90 transition-opacity",
        overAssigned
          ? "bg-destructive/10 border border-destructive/30"
          : "bg-primary/5 border border-primary/20",
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
