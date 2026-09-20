"use client";

import type { QueryClient } from "@tanstack/react-query";
import { defineQuery } from "./define-query";
import type { ReportsDashboardResponse } from "@/app/api/reports/dashboard/route";
import type { SpendingReportResponse } from "@/app/api/reports/spending/route";

// ---------------------------------------------------------------------------
// Dashboard (app/(app)/reports/page.tsx)
// ---------------------------------------------------------------------------

async function fetchReportsDashboard(): Promise<ReportsDashboardResponse> {
  const res = await fetch("/api/reports/dashboard");
  if (!res.ok) throw new Error("Failed to load reports");
  return res.json();
}

const dashboardQuery = defineQuery("reports-dashboard", fetchReportsDashboard);

export function useReportsDashboard() {
  return dashboardQuery.useResource([]);
}

export function prefetchReportsDashboard(queryClient: QueryClient) {
  return dashboardQuery.prefetch(queryClient);
}

// ---------------------------------------------------------------------------
// Spending report (app/(app)/reports/spending/page.tsx)
// ---------------------------------------------------------------------------

async function fetchSpendingReport(
  periodKey: string,
  categoryIds: string[],
  drillCategoryId: string | null,
): Promise<SpendingReportResponse> {
  const params = new URLSearchParams({ period: periodKey });
  if (categoryIds.length > 0) params.set("categories", categoryIds.join(","));
  if (drillCategoryId) params.set("drill", drillCategoryId);
  const res = await fetch(`/api/reports/spending?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load spending report");
  return res.json();
}

const spendingReportQuery = defineQuery("spending-report", fetchSpendingReport);

export function useSpendingReport(
  periodKey: string,
  categoryIds: string[],
  drillCategoryId: string | null,
) {
  return spendingReportQuery.useResource([periodKey, categoryIds, drillCategoryId]);
}

/** Warms the cache for a period/filter combination before the user clicks into it. */
export function prefetchSpendingReport(
  queryClient: QueryClient,
  periodKey: string,
  categoryIds: string[],
  drillCategoryId: string | null,
) {
  return spendingReportQuery.prefetch(queryClient, periodKey, categoryIds, drillCategoryId);
}
