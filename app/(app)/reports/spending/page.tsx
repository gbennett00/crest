import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { computeCategoryBreakdown, getPeriodRange, listActivityPeriods } from "@/lib/reports";
import { currentBudgetMonth } from "@/lib/ledger";
import { DEFAULT_PERIOD_KEY } from "@/lib/reports/period";
import { SpendingScreen, type ReportGroup } from "@/components/reports/spending-screen";
import type { ReportTxn } from "@/components/reports/report-transaction-list";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-form";

type SearchParams = {
  period?: string;
  categories?: string;
  drill?: string;
};

export default function SpendingReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return (
    <Suspense fallback={<ReportsSkeleton />}>
      <ReportsContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ReportsContent({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const periodKey = sp.period ?? DEFAULT_PERIOD_KEY;
  const categoryIds = sp.categories ? sp.categories.split(",").filter(Boolean) : [];
  const drillCategoryId = sp.drill || null;

  const range = getPeriodRange(periodKey);
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

  const [breakdown, activityPeriods, groupsRes, accountsRes, categoriesRes, drillRes] = await Promise.all([
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
    supabase
      .from("categories")
      .select("id, name, role, category_groups!group_id(name)")
      .eq("is_hidden", false)
      .order("name"),
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
    // The system group holding only Ready to Assign has nothing left once
    // that's filtered out — drop it rather than show an empty group.
    .filter((g) => g.categories.length > 0);

  const accounts: AccountOption[] = ((accountsRes.data ?? []) as { id: string; name: string }[]).map(
    (a) => ({ id: a.id, name: a.name }),
  );

  // Categorize-picker options for the drill-down panel — same shape/convention
  // as the account register (RTA included as a valid recategorize target).
  const categoryOptions: CategoryOption[] = (
    (categoriesRes.data ?? []) as unknown as Array<{
      id: string;
      name: string;
      role: string | null;
      category_groups: { name: string } | null;
    }>
  ).map((c) => ({
    id: c.id,
    name: c.role === "ready_to_assign" ? "Ready to Assign" : c.name,
    groupName: c.role === "ready_to_assign" ? "— Inflows —" : (c.category_groups?.name ?? "Other"),
  }));

  const drillCategory = drillCategoryId
    ? breakdown.rows.find((r) => r.categoryId === drillCategoryId)
    : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drillTxns = (drillRes.data ?? []) as any[];
  const drillTransactions: ReportTxn[] = drillTxns.map((txn) => {
    // The category's share of this transaction (summed in case a split
    // allocated to the same category more than once).
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

  return (
    <SpendingScreen
      periodKey={periodKey}
      years={years}
      months={months}
      periodLabel={range.label}
      selectedCategoryIds={categoryIds}
      groups={groups}
      breakdown={breakdown}
      accounts={accounts}
      categoryOptions={categoryOptions}
      drillCategoryId={drillCategoryId}
      drillCategoryName={drillCategory?.categoryName ?? null}
      drillTransactions={drillTransactions}
    />
  );
}

function ReportsSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-4 md:px-10 py-8 animate-pulse space-y-6">
      <div className="h-6 w-28 bg-muted rounded" />
      <div className="h-9 w-full max-w-md bg-muted rounded-full" />
      <div className="h-64 bg-muted rounded-xl" />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 bg-muted rounded" />
        ))}
      </div>
    </div>
  );
}
