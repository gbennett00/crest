import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentBudgetMonth, nextBudgetMonth } from "@/lib/ledger";
import {
  computeCategoryBreakdown,
  loadIncomeVsSpending,
  loadNetWorthSeries,
  lastNMonths,
  type CategoryBreakdown,
  type MonthlyIncomeSpending,
  type NetWorthPoint,
} from "@/lib/reports";

const TREND_MONTHS = 6;

export type ReportsDashboardResponse = {
  incomeVsSpending: MonthlyIncomeSpending[];
  netWorthSeries: NetWorthPoint[];
  thisMonthBreakdown: CategoryBreakdown;
};

// Same queries the reports dashboard's Server Component ran, exposed as JSON
// for the client-side query cache (lib/queries/reports.ts).
export async function GET() {
  const supabase = await createClient();
  const months = lastNMonths(TREND_MONTHS);
  const thisMonth = currentBudgetMonth();

  const [incomeVsSpending, netWorthSeries, thisMonthBreakdown] = await Promise.all([
    loadIncomeVsSpending(supabase, months),
    loadNetWorthSeries(supabase, months),
    computeCategoryBreakdown(supabase, { from: thisMonth, to: nextBudgetMonth(thisMonth) }),
  ]);

  const response: ReportsDashboardResponse = { incomeVsSpending, netWorthSeries, thisMonthBreakdown };
  return NextResponse.json(response);
}
