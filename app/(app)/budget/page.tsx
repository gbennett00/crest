import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { computeAvailableThrough, currentBudgetMonth } from "@/lib/ledger";
import { BudgetScreen } from "@/components/budget/budget-screen";
import type { BudgetCategory, BudgetData, BudgetGroup, TargetData } from "@/components/budget/budget-screen";

const BUDGET_MONTH_RE = /^\d{4}-\d{2}-01$/;

export default function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  return (
    <Suspense fallback={<BudgetSkeleton />}>
      <BudgetContent searchParams={searchParams} />
    </Suspense>
  );
}

async function BudgetContent({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: rawMonth } = await searchParams;
  const month = BUDGET_MONTH_RE.test(rawMonth ?? "") ? rawMonth! : currentBudgetMonth();
  const todayMonth = currentBudgetMonth();

  const supabase = await createClient();

  // Wave 1: all the data needed to render spending categories/groups
  const [groupsRes, catActivityRes, catAssignedRes, grpActivityRes, grpAssignedRes, targetsRes] =
    await Promise.all([
      supabase
        .from("category_groups")
        .select(
          "id, name, budget_mode, is_pinned, categories(id, name, role, is_pinned, is_hidden)",
        )
        .order("is_pinned", { ascending: false })
        .order("name"),
      supabase
        .from("category_monthly_activity")
        .select("category_id, month, activity_cents")
        .lte("month", month),
      supabase
        .from("category_monthly_assigned")
        .select("category_id, month, assigned_cents")
        .lte("month", month),
      supabase
        .from("group_monthly_activity")
        .select("group_id, month, activity_cents")
        .lte("month", month),
      supabase
        .from("group_monthly_assigned")
        .select("group_id, month, assigned_cents")
        .lte("month", month),
      supabase
        .from("targets")
        .select("category_id, group_id, type, amount_cents, target_date"),
    ]);

  // Find RTA category ID from the groups data (synchronous — no extra round trip)
  let rtaId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outer: for (const g of (groupsRes.data ?? []) as any[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of (g.categories ?? []) as any[]) {
      if (c.role === "ready_to_assign") { rtaId = c.id as string; break outer; }
    }
  }

  // Wave 2: RTA-specific queries — activity through today, all spending assignments ever
  const [rtaActivityRes, allCatBudgetsRes, allGrpBudgetsRes] = await Promise.all([
    rtaId
      ? supabase
          .from("category_monthly_activity")
          .select("activity_cents")
          .eq("category_id", rtaId)
          .lte("month", todayMonth)
      : Promise.resolve({ data: [] }),
    rtaId
      ? supabase
          .from("monthly_budgets")
          .select("assigned_cents")
          .not("category_id", "is", null)
          .neq("category_id", rtaId)
      : Promise.resolve({ data: [] }),
    supabase
      .from("monthly_budgets")
      .select("assigned_cents")
      .not("group_id", "is", null),
  ]);

  // RTA = total inflows through today − total spending assignments (any month)
  const rtaActivity = (rtaActivityRes.data ?? []).reduce(
    (s, r) => s + (r.activity_cents as number), 0,
  );
  const totalSpendingAssigned =
    (allCatBudgetsRes.data ?? []).reduce((s, r) => s + (r.assigned_cents as number), 0) +
    (allGrpBudgetsRes.data ?? []).reduce((s, r) => s + (r.assigned_cents as number), 0);
  const rtaAvailableCents = rtaActivity - totalSpendingAssigned;

  // Build history maps for spending categories/groups
  const catActivityHistory: Record<string, Record<string, number>> = {};
  for (const row of catActivityRes.data ?? []) {
    (catActivityHistory[row.category_id as string] ??= {})[row.month as string] =
      row.activity_cents as number;
  }

  const catAssignedHistory: Record<string, Record<string, number>> = {};
  for (const row of catAssignedRes.data ?? []) {
    (catAssignedHistory[row.category_id as string] ??= {})[row.month as string] =
      row.assigned_cents as number;
  }

  const grpActivityHistory: Record<string, Record<string, number>> = {};
  for (const row of grpActivityRes.data ?? []) {
    (grpActivityHistory[row.group_id as string] ??= {})[row.month as string] =
      row.activity_cents as number;
  }

  const grpAssignedHistory: Record<string, Record<string, number>> = {};
  for (const row of grpAssignedRes.data ?? []) {
    (grpAssignedHistory[row.group_id as string] ??= {})[row.month as string] =
      row.assigned_cents as number;
  }

  // Build targets lookup
  const catTargets: Record<string, TargetData> = {};
  const grpTargets: Record<string, TargetData> = {};
  for (const t of targetsRes.data ?? []) {
    const td: TargetData = {
      type: t.type as TargetData["type"],
      amountCents: t.amount_cents as number,
      targetDate: (t.target_date as string) ?? null,
    };
    if (t.category_id) catTargets[t.category_id as string] = td;
    else if (t.group_id) grpTargets[t.group_id as string] = td;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups: BudgetGroup[] = (groupsRes.data ?? []).map((g: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sortedCats = [...(g.categories ?? [])].sort((a: any, b: any) => {
      if (a.is_pinned !== b.is_pinned) return Number(b.is_pinned) - Number(a.is_pinned);
      return (a.name as string).localeCompare(b.name as string);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const categories: BudgetCategory[] = sortedCats.map((c: any) => {
      const actHistory = catActivityHistory[c.id as string] ?? {};
      const asnHistory = catAssignedHistory[c.id as string] ?? {};
      // RTA available is computed separately above; skip it in the regular rollover
      const availableCents = c.role === "ready_to_assign"
        ? 0 // placeholder — RTA not shown as a budget row
        : computeAvailableThrough(month, actHistory, asnHistory);
      return {
        id: c.id as string,
        name: c.name as string,
        role: (c.role as "ready_to_assign" | null) ?? null,
        isPinned: c.is_pinned as boolean,
        isHidden: c.is_hidden as boolean,
        assignedCents: asnHistory[month] ?? 0,
        activityCents: actHistory[month] ?? 0,
        availableCents,
        target: catTargets[c.id as string] ?? null,
      };
    });

    return {
      id: g.id as string,
      name: g.name as string,
      budgetMode: g.budget_mode as "category" | "group",
      isPinned: g.is_pinned as boolean,
      categories,
      groupAssignedCents: grpAssignedHistory[g.id as string]?.[month] ?? 0,
      groupActivityCents: grpActivityHistory[g.id as string]?.[month] ?? 0,
      groupAvailableCents: computeAvailableThrough(
        month,
        grpActivityHistory[g.id as string] ?? {},
        grpAssignedHistory[g.id as string] ?? {},
      ),
      target: grpTargets[g.id as string] ?? null,
    };
  });

  const budgetData: BudgetData = { month, rtaAvailableCents, groups };
  return <BudgetScreen data={budgetData} />;
}

function BudgetSkeleton() {
  return (
    <div className="animate-pulse p-4 space-y-3">
      <div className="h-11 bg-muted rounded" />
      <div className="h-20 bg-muted rounded-lg" />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 bg-muted rounded" />
        ))}
      </div>
    </div>
  );
}
