import { BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { MonthlyIncomeSpending } from "@/lib/reports";
import { formatCompactCents } from "./chart-format";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const CHART_HEIGHT = 144; // px

export function IncomeVsSpendingCard({
  rows,
  insight,
}: {
  rows: MonthlyIncomeSpending[];
  insight: string;
}) {
  const maxCents = Math.max(1, ...rows.flatMap((r) => [r.incomeCents, r.spendingCents]));
  const hasActivity = rows.some((r) => r.incomeCents > 0 || r.spendingCents > 0);

  return (
    <Card>
      <CardContent className="p-5 md:p-6">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-primary mb-3">
          <BarChart3 size={15} />
          Income vs. Spending
        </div>
        <p className="text-[17px] font-medium leading-snug mb-6">{insight}</p>

        {!hasActivity ? (
          <p className="text-sm text-muted-foreground text-center py-8">Not enough activity yet.</p>
        ) : (
          <>
            <div className="flex gap-2">
              <div className="flex-1 relative" style={{ height: CHART_HEIGHT }}>
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                  <div className="border-t border-dashed border-border" />
                  <div className="border-t border-dashed border-border" />
                  <div className="border-t border-border" />
                </div>
                <div className="absolute inset-0 flex items-end gap-3 px-0.5">
                  {rows.map((r) => (
                    <div key={r.month} className="flex-1 flex items-end justify-center gap-1 h-full">
                      <div
                        className="w-2.5 md:w-3 rounded-t-sm bg-green-500"
                        style={{ height: `${(r.incomeCents / maxCents) * 100}%` }}
                      />
                      <div
                        className="w-2.5 md:w-3 rounded-t-sm bg-primary"
                        style={{ height: `${(r.spendingCents / maxCents) * 100}%` }}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div
                className="flex flex-col justify-between text-[11px] text-muted-foreground shrink-0 w-10 text-right"
                style={{ height: CHART_HEIGHT }}
              >
                <span>{formatCompactCents(maxCents)}</span>
                <span>{formatCompactCents(maxCents / 2)}</span>
                <span>$0</span>
              </div>
            </div>
            <div className="flex gap-3 mt-1.5 pr-10">
              {rows.map((r) => (
                <div key={r.month} className="flex-1 text-center text-[11px] text-muted-foreground">
                  {MONTH_ABBR[+r.month.slice(5, 7) - 1]}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-[3px] bg-green-500" /> Income
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2.5 h-2.5 rounded-[3px] bg-primary" /> Spending
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
