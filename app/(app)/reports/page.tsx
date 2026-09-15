import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { currentBudgetMonth, nextBudgetMonth } from "@/lib/ledger";
import {
  computeCategoryBreakdown,
  incomeVsSpendingInsight,
  lastNMonths,
  loadIncomeVsSpending,
  loadNetWorthSeries,
} from "@/lib/reports";
import { IncomeVsSpendingCard } from "@/components/reports/income-vs-spending-card";
import { NetWorthCard } from "@/components/reports/net-worth-card";
import { SpendingSummaryCard } from "@/components/reports/spending-summary-card";

const TREND_MONTHS = 6;

export default function ReportsDashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  const supabase = await createClient();
  const months = lastNMonths(TREND_MONTHS);
  const thisMonth = currentBudgetMonth();

  const [incomeVsSpending, netWorthSeries, thisMonthBreakdown] = await Promise.all([
    loadIncomeVsSpending(supabase, months),
    loadNetWorthSeries(supabase, months),
    computeCategoryBreakdown(supabase, { from: thisMonth, to: nextBudgetMonth(thisMonth) }),
  ]);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-10 py-6 md:py-8 space-y-4">
      <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Reports</h1>

      <IncomeVsSpendingCard rows={incomeVsSpending} insight={incomeVsSpendingInsight(incomeVsSpending)} />
      <NetWorthCard series={netWorthSeries} />
      <SpendingSummaryCard rows={thisMonthBreakdown.rows} totalCents={thisMonthBreakdown.totalCents} />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-10 py-8 animate-pulse space-y-4">
      <div className="h-6 w-28 bg-muted rounded" />
      <div className="h-64 bg-muted rounded-xl" />
      <div className="h-64 bg-muted rounded-xl" />
      <div className="h-64 bg-muted rounded-xl" />
    </div>
  );
}
