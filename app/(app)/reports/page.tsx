"use client";

import { IncomeVsSpendingCard } from "@/components/reports/income-vs-spending-card";
import { NetWorthCard } from "@/components/reports/net-worth-card";
import { SpendingSummaryCard } from "@/components/reports/spending-summary-card";
import { incomeVsSpendingInsight } from "@/lib/reports";
import { useReportsDashboard } from "@/lib/queries/reports";
import { useHasMounted } from "@/lib/use-has-mounted";

// No server-side data fetch here on purpose — see app/(app)/budget/page.tsx
// for why. DashboardContent owns its data through the client query cache
// (lib/queries/reports.ts), so a revisit renders straight from cache.
export default function ReportsDashboardPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-10 py-6 md:py-8 space-y-4">
      <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Reports</h1>
      <DashboardContent />
    </div>
  );
}

function DashboardContent() {
  const hasMounted = useHasMounted();
  const { data: response, isPending } = useReportsDashboard();

  if (!hasMounted || (isPending && !response)) {
    return <DashboardSkeleton />;
  }

  const { incomeVsSpending, netWorthSeries, thisMonthBreakdown } = response!;

  return (
    <>
      <SpendingSummaryCard rows={thisMonthBreakdown.rows} totalCents={thisMonthBreakdown.totalCents} />
      <NetWorthCard series={netWorthSeries} />
      <IncomeVsSpendingCard rows={incomeVsSpending} insight={incomeVsSpendingInsight(incomeVsSpending)} />
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-64 bg-muted rounded-xl" />
      <div className="h-64 bg-muted rounded-xl" />
      <div className="h-64 bg-muted rounded-xl" />
    </div>
  );
}
