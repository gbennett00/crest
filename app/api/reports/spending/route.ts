import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeCategoryBreakdown, getPeriodRange, listActivityPeriods } from "@/lib/reports";
import { currentBudgetMonth } from "@/lib/ledger";
import { loadCategoryOptions } from "@/lib/budget";
import type { ReportTxn } from "@/components/reports/report-transaction-list";
import type { ReportGroup } from "@/components/reports/spending-screen";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-form";
import type { CategoryBreakdown } from "@/lib/reports";

export type SpendingReportResponse = {
  years: number[];
  months: string[];
  breakdown: CategoryBreakdown;
  groups: ReportGroup[];
  accounts: AccountOption[];
  categoryOptions: CategoryOption[];
  drillCategoryName: string | null;
  drillTransactions: ReportTxn[];
};

// Same queries the spending report's Server Component ran, exposed as JSON
// for the client-side query cache (lib/queries/reports.ts).
export async function GET(request: NextRequest) {
  const periodKey = request.nextUrl.searchParams.get("period") ?? undefined;
  const categoryIds = (request.nextUrl.searchParams.get("categories") ?? "")
    .split(",")
    .filter(Boolean);
  const drillCategoryId = request.nextUrl.searchParams.get("drill") || null;

  const range = getPeriodRange(periodKey ?? "month");
  const supabase = await createClient();

  let drillQuery = supabase
    .from("transactions")
    .select(
      "id, payee, amount_cents, txn_date, approved_at, cleared_at, reconciled_at, memo, " +
        "accounts!transactions_account_id_fkey(name), " +
        "transaction_allocations!inner(amount_cents, category_id)",
    )
    .eq("transaction_allocations.category_id", drillCategoryId ?? "")
    .order("txn_date", { ascending: false });
  if (range.from) drillQuery = drillQuery.gte("txn_date", range.from);
  if (range.to) drillQuery = drillQuery.lt("txn_date", range.to);

  const [breakdown, activityPeriods, groupsRes, accountsRes, categoryOptions, drillRes] = await Promise.all([
    computeCategoryBreakdown(supabase, {
      from: range.from,
      to: range.to,
      categoryIds,
    }),
    listActivityPeriods(supabase),
    supabase
      .from("category_groups")
      .select("id, name, sort_index, categories(id, name, role, sort_index)")
      .order("sort_index")
      .order("sort_index", { referencedTable: "categories" }),
    supabase.from("accounts").select("id, name").eq("is_active", true).order("name"),
    loadCategoryOptions(supabase),
    drillCategoryId ? drillQuery : Promise.resolve({ data: null }),
  ]);

  // "This Year" already covers the current year, so the past-years picker
  // only offers years before it — once the calendar turns over, this year
  // naturally graduates into the list with no code change needed.
  const currentYear = +currentBudgetMonth().slice(0, 4);
  const years = activityPeriods.years.filter((y) => y !== currentYear);
  const months = activityPeriods.months;

  // Groups for the multi-select picker — every category incl. hidden ones, so
  // a report over a past period doesn't silently drop something that used to
  // be visible. Ready to Assign isn't a spending category, so it's excluded.
  const groups: ReportGroup[] = (
    (groupsRes.data ?? []) as unknown as Array<{
      id: string;
      name: string;
      categories: { id: string; name: string; role: string | null }[] | null;
    }>
  )
    .map((g) => ({
      id: g.id,
      name: g.name,
      categories: (g.categories ?? [])
        .filter((c) => c.role !== "ready_to_assign")
        .map((c) => ({ id: c.id, name: c.name })),
    }))
    .filter((g) => g.categories.length > 0);

  const accounts: AccountOption[] = ((accountsRes.data ?? []) as { id: string; name: string }[]).map(
    (a) => ({ id: a.id, name: a.name }),
  );

  const drillCategoryName = drillCategoryId
    ? breakdown.rows.find((r) => r.categoryId === drillCategoryId)?.categoryName ?? null
    : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drillTxns = (drillRes.data ?? []) as any[];
  const drillTransactions: ReportTxn[] = drillTxns.map((txn) => {
    const categoryAmountCents = (
      (txn.transaction_allocations ?? []) as { amount_cents: number }[]
    ).reduce((s, a) => s + a.amount_cents, 0);
    const accountsData = Array.isArray(txn.accounts) ? txn.accounts[0] : txn.accounts;
    return {
      id: txn.id,
      payee: txn.payee,
      amountCents: categoryAmountCents,
      txnDate: txn.txn_date,
      approved: !!txn.approved_at,
      cleared: !!txn.cleared_at,
      reconciled: !!txn.reconciled_at,
      memo: txn.memo,
      accountName: (accountsData as { name: string } | null)?.name ?? "Unknown",
    };
  });

  const response: SpendingReportResponse = {
    years,
    months,
    breakdown,
    groups,
    accounts,
    categoryOptions,
    drillCategoryName,
    drillTransactions,
  };
  return NextResponse.json(response);
}
