"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PeriodSelector } from "./period-selector";
import { ReportsFilterBar } from "./reports-filter-bar";
import { SpendingDonut } from "./spending-donut";
import { CategoryBreakdownList } from "./category-breakdown-list";
import { ReportTransactionPanel } from "./report-transaction-panel";
import type { ReportTxn } from "./report-transaction-list";
import type { CategoryBreakdown } from "@/lib/reports";
import { DEFAULT_PERIOD_KEY } from "@/lib/reports/period";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-form";

export type ReportGroup = {
  id: string;
  name: string;
  categories: { id: string; name: string }[];
};

function buildHref(params: {
  period: string;
  categoryIds: string[];
  drillId: string | null;
}): string {
  const search = new URLSearchParams();
  if (params.period !== DEFAULT_PERIOD_KEY) search.set("period", params.period);
  if (params.categoryIds.length > 0) search.set("categories", params.categoryIds.join(","));
  if (params.drillId) search.set("drill", params.drillId);
  const qs = search.toString();
  return qs ? `/reports/spending?${qs}` : "/reports/spending";
}

export function SpendingScreen({
  periodKey,
  years,
  months,
  periodLabel,
  selectedCategoryIds,
  groups,
  breakdown,
  accounts,
  categoryOptions,
  drillCategoryId,
  drillCategoryName,
  drillTransactions,
}: {
  periodKey: string;
  years: number[];
  months: string[];
  periodLabel: string;
  selectedCategoryIds: string[];
  groups: ReportGroup[];
  breakdown: CategoryBreakdown;
  accounts: AccountOption[];
  categoryOptions: CategoryOption[];
  drillCategoryId: string | null;
  drillCategoryName: string | null;
  drillTransactions: ReportTxn[];
}) {
  const router = useRouter();

  function go(overrides: Partial<{ period: string; categoryIds: string[]; drillId: string | null }>) {
    router.push(
      buildHref({
        period: overrides.period ?? periodKey,
        categoryIds: overrides.categoryIds ?? selectedCategoryIds,
        drillId: "drillId" in overrides ? (overrides.drillId ?? null) : drillCategoryId,
      }),
      { scroll: false },
    );
  }

  const backHref = buildHref({ period: periodKey, categoryIds: selectedCategoryIds, drillId: drillCategoryId });

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-10 py-6 md:py-8">
      <Link
        href="/reports"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground mb-2"
      >
        <ChevronLeft size={14} /> Reports
      </Link>
      <h1 className="text-xl md:text-2xl font-semibold tracking-tight mb-5">Spending</h1>

      <div className="space-y-3">
        <PeriodSelector
          periodKey={periodKey}
          years={years}
          months={months}
          onSelect={(key) => go({ period: key, drillId: null })}
        />
        <ReportsFilterBar
          groups={groups}
          selectedCategoryIds={selectedCategoryIds}
          onApply={(categoryIds) => go({ categoryIds, drillId: null })}
        />
      </div>

      {breakdown.rows.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-20">
          No spending in this period{selectedCategoryIds.length > 0 ? " for the selected categories" : ""}.
        </p>
      ) : (
        <>
          <div className="mt-8 md:mt-10">
            <SpendingDonut rows={breakdown.rows} totalCents={breakdown.totalCents} />
          </div>
          <CategoryBreakdownList
            rows={breakdown.rows}
            onSelect={(categoryId) => go({ drillId: categoryId })}
          />
        </>
      )}

      {drillCategoryId && (
        <ReportTransactionPanel
          categoryName={drillCategoryName ?? "Category"}
          periodLabel={periodLabel}
          transactions={drillTransactions}
          categories={categoryOptions}
          accounts={accounts}
          backHref={backHref}
          onClose={() => go({ drillId: null })}
        />
      )}
    </div>
  );
}
