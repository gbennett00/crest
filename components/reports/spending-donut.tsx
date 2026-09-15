import { Money } from "@/components/money";
import type { CategoryBreakdownRow } from "@/lib/reports";
import { colorForIndex, REPORT_COLORS } from "./palette";

const RADIUS = 80;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Beyond this many slices the ring gets illegible, so the tail is folded into
// one "Other" slice. The list below the chart still shows every category.
const MAX_SLICES = 7;

/**
 * The circle chart on its own — no legend beside it. A legend here would
 * just repeat the name/amount/percent the category list directly below
 * already shows, so the chart's only job is the shape of the breakdown; the
 * list is where you read the numbers.
 */
export function SpendingDonut({
  rows,
  totalCents,
}: {
  rows: CategoryBreakdownRow[];
  totalCents: number;
}) {
  const slices =
    rows.length > MAX_SLICES
      ? [
          ...rows.slice(0, MAX_SLICES),
          {
            categoryId: "__other__",
            categoryName: "Other",
            spentCents: rows.slice(MAX_SLICES).reduce((s, r) => s + r.spentCents, 0),
          },
        ]
      : rows;

  let cumulative = 0;
  const arcs = slices.map((slice, i) => {
    const fraction = totalCents > 0 ? slice.spentCents / totalCents : 0;
    const length = fraction * CIRCUMFERENCE;
    const arc = {
      color: slice.categoryId === "__other__" ? REPORT_COLORS[REPORT_COLORS.length - 1] : colorForIndex(i),
      dasharray: `${length} ${CIRCUMFERENCE - length}`,
      dashoffset: -cumulative,
    };
    cumulative += length;
    return arc;
  });

  return (
    <div className="relative w-[220px] h-[220px] mx-auto shrink-0">
      <svg width="220" height="220" viewBox="0 0 200 200">
        <g transform="rotate(-90 100 100)">
          {arcs.map((arc, i) => (
            <circle
              key={i}
              cx="100"
              cy="100"
              r={RADIUS}
              fill="none"
              stroke={arc.color}
              strokeWidth="28"
              strokeDasharray={arc.dasharray}
              strokeDashoffset={arc.dashoffset}
            />
          ))}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-bold tabular-nums">
          <Money cents={totalCents} />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mt-1">
          Total Spent
        </div>
      </div>
    </div>
  );
}
