import Link from "next/link";
import { ChevronRight, PieChart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/money";
import type { CategoryBreakdownRow } from "@/lib/reports";
import { colorForIndex } from "./palette";

const TOP_N = 5;

/**
 * The dashboard's condensed spending card — this month's top categories as a
 * simple bar list, not the full donut. Clicking through opens the full
 * period/category picker + drill-down experience at /reports/spending.
 */
export function SpendingSummaryCard({
  rows,
  totalCents,
}: {
  rows: CategoryBreakdownRow[];
  totalCents: number;
}) {
  const top = rows.slice(0, TOP_N);
  const maxCents = Math.max(1, ...top.map((r) => r.spentCents));

  return (
    <Link href="/reports/spending" className="block">
      <Card className="hover:border-primary/40 transition-colors">
        <CardContent className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-primary">
              <PieChart size={15} />
              Spending
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </div>

          {top.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No spending yet this month.</p>
          ) : (
            <>
              <div className="text-[13px] text-muted-foreground mb-4">
                <span className="font-semibold text-foreground">
                  <Money cents={totalCents} />
                </span>{" "}
                total this month
              </div>
              <div className="space-y-3">
                {top.map((row, i) => (
                  <div key={row.categoryId}>
                    <div className="flex items-center justify-between text-sm mb-1 gap-2">
                      <span className="font-medium truncate">{row.categoryName}</span>
                      <span className="tabular-nums font-medium shrink-0">
                        <Money cents={row.spentCents} />
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(row.spentCents / maxCents) * 100}%`,
                          background: colorForIndex(i),
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {rows.length > top.length && (
                <p className="text-xs text-muted-foreground mt-3">
                  +{rows.length - top.length} more {rows.length - top.length === 1 ? "category" : "categories"}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
