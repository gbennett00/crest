import type { SupabaseClient } from "@supabase/supabase-js";

export type MonthlyIncomeSpending = {
  month: string;
  incomeCents: number;
  spendingCents: number;
};

type ActivityRow = { category_id: string; month: string; activity_cents: number };

/**
 * Buckets activity rows into income (Ready to Assign inflows) vs. spending
 * (net outflow across every other category) per month. Both are clamped to
 * >= 0: a month where RTA nets negative (a paycheck later recategorized
 * away) reads as zero income rather than "negative income", and a month
 * where refunds outweigh purchases reads as zero spending rather than
 * "negative spending" — the chart is about the shape of income vs. spend,
 * not signed net activity.
 */
export function aggregateIncomeVsSpending(
  activityRows: ActivityRow[],
  months: string[],
  rtaCategoryId: string | null,
): MonthlyIncomeSpending[] {
  const byMonth = new Map<string, { income: number; spending: number }>();
  for (const m of months) byMonth.set(m, { income: 0, spending: 0 });

  for (const row of activityRows) {
    const bucket = byMonth.get(row.month);
    if (!bucket) continue;
    if (rtaCategoryId && row.category_id === rtaCategoryId) bucket.income += row.activity_cents;
    else bucket.spending += row.activity_cents;
  }

  return months.map((month) => {
    const b = byMonth.get(month)!;
    return {
      month,
      incomeCents: Math.max(0, b.income),
      spendingCents: Math.max(0, -b.spending),
    };
  });
}

export async function loadIncomeVsSpending(
  client: SupabaseClient,
  months: string[],
): Promise<MonthlyIncomeSpending[]> {
  if (months.length === 0) return [];
  const minMonth = months[0];
  const maxMonth = months[months.length - 1];

  const [activityRes, rtaRes] = await Promise.all([
    client
      .from("category_monthly_activity")
      .select("category_id, month, activity_cents")
      .gte("month", minMonth)
      .lte("month", maxMonth),
    client.from("categories").select("id").eq("role", "ready_to_assign").maybeSingle(),
  ]);

  const rtaCategoryId = (rtaRes.data as { id: string } | null)?.id ?? null;
  return aggregateIncomeVsSpending((activityRes.data ?? []) as ActivityRow[], months, rtaCategoryId);
}

/** One-line summary comparing average income to average spending across the series. */
export function incomeVsSpendingInsight(rows: MonthlyIncomeSpending[]): string {
  if (rows.length === 0) return "No activity yet.";
  const avgIncome = rows.reduce((s, r) => s + r.incomeCents, 0) / rows.length;
  const avgSpending = rows.reduce((s, r) => s + r.spendingCents, 0) / rows.length;
  if (avgIncome === 0 && avgSpending === 0) return "No activity yet.";

  // Within 5% either way reads as "about the same".
  const diff = avgIncome === 0 ? Infinity : (avgSpending - avgIncome) / avgIncome;
  if (Math.abs(diff) <= 0.05) return "On average, you're spending about as much as you make.";
  if (diff < 0) return "On average, you're spending less than you make.";
  return "On average, you're spending more than you make.";
}
