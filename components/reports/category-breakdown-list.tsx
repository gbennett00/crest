import { Money } from "@/components/money";
import type { CategoryBreakdownRow } from "@/lib/reports";
import { colorForIndex } from "./palette";
import { cn } from "@/lib/utils";

export function CategoryBreakdownList({
  rows,
  onSelect,
}: {
  rows: CategoryBreakdownRow[];
  onSelect: (categoryId: string) => void;
}) {
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-1 mb-1">
        All categories
      </p>
      {rows.map((row, i) => (
        <button
          key={row.categoryId}
          type="button"
          onClick={() => onSelect(row.categoryId)}
          className={cn(
            "w-full flex items-center justify-between gap-3 px-2 py-3 border-b last:border-b-0",
            "text-left hover:bg-muted/40 rounded-md transition-colors",
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-[3px] shrink-0"
              style={{ background: colorForIndex(i) }}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{row.categoryName}</p>
              <p className="text-xs text-muted-foreground truncate">{row.groupName}</p>
            </div>
          </div>
          <div className="flex items-baseline gap-3 shrink-0">
            <span className="text-sm font-semibold tabular-nums">
              <Money cents={row.spentCents} />
            </span>
            <span className="text-xs text-muted-foreground tabular-nums w-11 text-right">
              {row.pct.toFixed(1)}%
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
