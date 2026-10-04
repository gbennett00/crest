"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { StickyHeader } from "@/components/ui/sticky-header";
import { useFormattedCents } from "@/components/money";
import { buildMoveHistory, type MoveSource } from "@/lib/budget/moves-history";
import { useBudgetMoves } from "@/lib/queries/budget-moves";
import { useHasMounted } from "@/lib/use-has-mounted";
import { cn } from "@/lib/utils";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const BUDGET_MONTH_RE = /^\d{4}-\d{2}-01$/;

function formatMonth(month: string): string {
  return `${MONTH_NAMES[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}`;
}

const SOURCE_TAGS: Partial<Record<MoveSource, string>> = {
  cover: "Cover overspending",
  import: "Imported",
};

// "View moves" from a category/group row menu on the plan page: every move of
// assigned money into or out of that funding unit for one budget month
// (?month=), or all months, grouped by the day it happened. The URL is the
// only state, like the category transactions drill-down.
export default function BudgetMovesPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <BudgetMovesContent />
    </Suspense>
  );
}

function BudgetMovesContent() {
  const searchParams = useSearchParams();
  const categoryId = searchParams.get("category");
  const groupId = searchParams.get("group");
  const rawMonth = searchParams.get("month");
  const month = rawMonth && BUDGET_MONTH_RE.test(rawMonth) ? rawMonth : null;
  const allMonths = searchParams.get("all") === "1";
  const hasMounted = useHasMounted();
  const formatCents = useFormattedCents();

  const unit = categoryId
    ? ({ type: "category", id: categoryId } as const)
    : groupId
      ? ({ type: "group", id: groupId } as const)
      : null;

  const { data, isPending, isError } = useBudgetMoves(
    { unit: unit ?? { type: "category", id: "" }, month: allMonths ? null : month },
    !!unit,
  );

  const unitId = unit?.id;
  const groups = useMemo(
    () => (data && unitId ? buildMoveHistory(data.moves, unitId) : []),
    [data, unitId],
  );

  if (!unit) {
    return <p className="text-center text-sm text-muted-foreground py-16">No category selected.</p>;
  }

  const monthLabel = month ? formatMonth(month) : null;
  const backHref = month ? `/budget?month=${month}` : "/budget";
  const baseHref = `/budget/moves?${unit.type}=${unit.id}${month ? `&month=${month}` : ""}`;
  const showAll = allMonths || !month;

  return (
    <div className="max-w-2xl">
      <StickyHeader className="px-4 py-3 flex items-center gap-3">
        <Link href={backHref} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-sm truncate">
            {hasMounted && data ? data.unitName : "Moves"}
          </h1>
          <p className="text-xs text-muted-foreground">
            Moves · {showAll ? "All months" : monthLabel}
          </p>
        </div>
        {month && (
          <Link
            href={allMonths ? baseHref : `${baseHref}&all=1`}
            className="shrink-0 text-xs font-medium text-primary hover:underline"
          >
            {allMonths ? `Only ${monthLabel}` : "All months"}
          </Link>
        )}
      </StickyHeader>

      {!hasMounted || (isPending && !data) ? (
        <Skeleton />
      ) : isError ? (
        <p className="text-center text-sm text-destructive py-16">Failed to load moves.</p>
      ) : groups.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">
          No moves{showAll ? "" : ` in ${monthLabel}`}.
        </p>
      ) : (
        <div>
          {groups.map((group) => (
            <section key={group.label}>
              <h2 className="px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/40 border-b">
                {group.label}
              </h2>
              {group.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3 border-b text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{item.fromName}</span>
                      <ArrowRight size={14} className="shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{item.toName}</span>
                    </div>
                    {(SOURCE_TAGS[item.source] || showAll) && (
                      <p className="text-xs text-muted-foreground">
                        {[
                          // Across all months, say which budget month it was for.
                          showAll && `For ${formatMonth(item.month)}`,
                          SOURCE_TAGS[item.source],
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 tabular-nums font-medium",
                      item.signedCents < 0 && "text-muted-foreground",
                    )}
                  >
                    {item.signedCents > 0 ? "+" : ""}
                    {formatCents(item.signedCents)}
                  </span>
                </div>
              ))}
            </section>
          ))}
          {data?.truncated && (
            <p className="text-center text-xs text-muted-foreground py-4">
              Showing the most recent {data.moves.length} moves.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse p-4 space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-12 bg-muted rounded" />
      ))}
    </div>
  );
}
