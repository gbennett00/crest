import type { SupabaseClient } from "@supabase/supabase-js";

export type CategoryBreakdownRow = {
  categoryId: string;
  categoryName: string;
  groupId: string;
  groupName: string;
  /** Positive magnitude spent (net of refunds within the period). */
  spentCents: number;
  /** 0-100, share of `totalCents`. */
  pct: number;
};

export type CategoryBreakdown = {
  totalCents: number;
  rows: CategoryBreakdownRow[];
};

type ActivityRow = { category_id: string; month: string; activity_cents: number };

type CategoryMeta = {
  name: string;
  groupId: string;
  groupName: string;
};

/**
 * Sums `category_monthly_activity` rows per category and turns any category
 * with net negative activity (i.e. it was actually spent from, not just
 * refunded into) into a breakdown row. Pure so period/selection edge cases
 * are testable without a database.
 */
export function aggregateSpending(
  activityRows: ActivityRow[],
  categoryMeta: Map<string, CategoryMeta>,
): CategoryBreakdown {
  const sums = new Map<string, number>();
  for (const row of activityRows) {
    sums.set(row.category_id, (sums.get(row.category_id) ?? 0) + row.activity_cents);
  }

  const rows: CategoryBreakdownRow[] = [];
  let totalCents = 0;
  for (const [categoryId, netCents] of sums) {
    if (netCents >= 0) continue; // refunds only / no net spend this period
    const meta = categoryMeta.get(categoryId);
    if (!meta) continue; // e.g. Ready to Assign, or a since-deleted category
    const spentCents = -netCents;
    rows.push({
      categoryId,
      categoryName: meta.name,
      groupId: meta.groupId,
      groupName: meta.groupName,
      spentCents,
      pct: 0,
    });
    totalCents += spentCents;
  }

  for (const row of rows) row.pct = totalCents > 0 ? (row.spentCents / totalCents) * 100 : 0;
  rows.sort((a, b) => b.spentCents - a.spentCents);

  return { totalCents, rows };
}

/**
 * Loads the spending breakdown for `[from, to)` (either bound may be null for
 * an open range — "All Time"), optionally restricted to `categoryIds`.
 * Reads `category_monthly_activity`, the same approved-ledger-only read model
 * the budget screen uses, so report totals always agree with budget activity.
 */
export async function computeCategoryBreakdown(
  client: SupabaseClient,
  opts: { from: string | null; to: string | null; categoryIds?: string[] },
): Promise<CategoryBreakdown> {
  let activityQuery = client
    .from("category_monthly_activity")
    .select("category_id, month, activity_cents");
  if (opts.from) activityQuery = activityQuery.gte("month", opts.from);
  if (opts.to) activityQuery = activityQuery.lt("month", opts.to);
  if (opts.categoryIds && opts.categoryIds.length > 0) {
    activityQuery = activityQuery.in("category_id", opts.categoryIds);
  }

  const [activityRes, categoriesRes] = await Promise.all([
    activityQuery,
    client
      .from("categories")
      .select("id, name, role, group_id, category_groups!group_id(name)"),
  ]);

  const categoryMeta = new Map<string, CategoryMeta>();
  for (const c of (categoriesRes.data ?? []) as unknown as Array<{
    id: string;
    name: string;
    role: string | null;
    group_id: string;
    category_groups: { name: string } | null;
  }>) {
    if (c.role === "ready_to_assign") continue; // not a spending category
    categoryMeta.set(c.id, {
      name: c.name,
      groupId: c.group_id,
      groupName: c.category_groups?.name ?? "Other",
    });
  }

  return aggregateSpending((activityRes.data ?? []) as ActivityRow[], categoryMeta);
}

/** Distinct calendar years with any net spending, newest first — for the "past years" picker. */
export async function listYearsWithSpending(client: SupabaseClient): Promise<number[]> {
  const { data } = await client
    .from("category_monthly_activity")
    .select("month")
    .lt("activity_cents", 0);

  const years = new Set<number>();
  for (const row of (data ?? []) as { month: string }[]) years.add(+row.month.slice(0, 4));
  return [...years].sort((a, b) => b - a);
}
