"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_PERIOD_KEY, getPeriodRange } from "@/lib/reports/period";
import { SpendingScreen } from "@/components/reports/spending-screen";
import { useSpendingReport } from "@/lib/queries/reports";
import { useHasMounted } from "@/lib/use-has-mounted";

// No server-side data fetch here on purpose — see app/(app)/budget/page.tsx
// for why. ReportsContent owns its data through the client query cache
// (lib/queries/reports.ts), so changing the period/category filters (or
// coming back to a period you were just viewing) renders from cache instead
// of a fresh round-trip.
export default function SpendingReportPage() {
  return (
    <Suspense fallback={<ReportsSkeleton />}>
      <ReportsContent />
    </Suspense>
  );
}

function ReportsContent() {
  const searchParams = useSearchParams();
  const periodKey = searchParams.get("period") ?? DEFAULT_PERIOD_KEY;
  const categoryIds = searchParams.get("categories")?.split(",").filter(Boolean) ?? [];
  const drillCategoryId = searchParams.get("drill") || null;
  const hasMounted = useHasMounted();

  const { data: response, isPending } = useSpendingReport(periodKey, categoryIds, drillCategoryId);

  if (!hasMounted || (isPending && !response)) {
    return <ReportsSkeleton />;
  }

  const range = getPeriodRange(periodKey);

  return (
    <SpendingScreen
      periodKey={periodKey}
      years={response!.years}
      months={response!.months}
      periodLabel={range.label}
      selectedCategoryIds={categoryIds}
      groups={response!.groups}
      breakdown={response!.breakdown}
      accounts={response!.accounts}
      categoryOptions={response!.categoryOptions}
      drillCategoryId={drillCategoryId}
      drillCategoryName={response!.drillCategoryName}
      drillTransactions={response!.drillTransactions}
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
