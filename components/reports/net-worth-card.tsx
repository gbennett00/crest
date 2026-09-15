"use client";

import { Landmark } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/money";
import type { NetWorthPoint } from "@/lib/reports";
import { useFormattedCompactCents } from "./chart-format";
import { cn } from "@/lib/utils";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const CHART_HEIGHT = 144; // px

export function NetWorthCard({ series }: { series: NetWorthPoint[] }) {
  const current = series[series.length - 1];
  const maxNet = Math.max(1, ...series.map((p) => p.netCents));
  const formatCompact = useFormattedCompactCents();

  const linePoints = series
    .map((p, i) => {
      const x = ((i + 0.5) / series.length) * 100;
      const y = 100 - Math.max(0, Math.min(1, p.netCents / maxNet)) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <Card>
      <CardContent className="p-5 md:p-6">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-primary mb-3">
          <Landmark size={15} />
          Net Worth
        </div>

        <div className="text-[28px] font-bold tracking-tight tabular-nums mb-3">
          <Money cents={current?.netCents ?? 0} />
        </div>

        <div className="flex items-center justify-between text-sm py-1.5 border-t">
          <span className="text-muted-foreground">Assets</span>
          <span className="font-medium tabular-nums">
            <Money cents={current?.assetsCents ?? 0} />
          </span>
        </div>
        <div className="flex items-center justify-between text-sm py-1.5 border-t border-b mb-5">
          <span className="text-destructive">Debts</span>
          <span className="font-medium tabular-nums text-destructive">
            <Money cents={current?.debtsCents ?? 0} />
          </span>
        </div>

        <div className="flex gap-2">
          <div className="flex-1 relative" style={{ height: CHART_HEIGHT }}>
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              <div className="border-t border-dashed border-border" />
              <div className="border-t border-dashed border-border" />
              <div className="border-t border-border" />
            </div>
            <div className="absolute inset-0 flex items-end gap-3 px-0.5">
              {series.map((p, i) => (
                <div
                  key={p.month}
                  className={cn(
                    "flex-1 rounded-t-sm",
                    i === series.length - 1 ? "bg-primary" : "bg-primary/40",
                  )}
                  style={{ height: `${Math.max(0, Math.min(1, p.netCents / maxNet)) * 100}%` }}
                />
              ))}
            </div>
            <svg
              className="absolute inset-0 w-full h-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <polyline
                points={linePoints}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                className="text-foreground/70"
              />
            </svg>
          </div>
          <div
            className="flex flex-col justify-between text-[11px] text-muted-foreground shrink-0 w-10 text-right"
            style={{ height: CHART_HEIGHT }}
          >
            <span>{formatCompact(maxNet)}</span>
            <span>{formatCompact(maxNet / 2)}</span>
            <span>$0</span>
          </div>
        </div>
        <div className="flex gap-3 mt-1.5 pr-10">
          {series.map((p) => (
            <div key={p.month} className="flex-1 text-center text-[11px] text-muted-foreground">
              {MONTH_ABBR[+p.month.slice(5, 7) - 1]}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
