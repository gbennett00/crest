"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { upsertCategoryBudget, upsertGroupBudget } from "@/lib/ledger";
import { getActivePlanId } from "@/lib/plan/active-plan";

// RTA is computed directly on read (see budget/page.tsx and home/page.tsx).
// No monthly_budget entry is written for the RTA category — assignments to
// spending categories simply reduce RTA implicitly.

export async function assignCategory(
  categoryId: string,
  month: string,
  assignedCents: number,
) {
  const supabase = await createClient();
  await upsertCategoryBudget(supabase, { categoryId, month, assignedCents });
  revalidatePath("/budget");
}

export async function assignGroup(
  groupId: string,
  month: string,
  assignedCents: number,
) {
  const supabase = await createClient();
  await upsertGroupBudget(supabase, { groupId, month, assignedCents });
  revalidatePath("/budget");
}

export async function togglePin(id: string, type: "category" | "group") {
  const supabase = await createClient();
  const table = type === "category" ? "categories" : "category_groups";
  const { data } = await supabase.from(table).select("is_pinned").eq("id", id).single();
  const { error } = await supabase
    .from(table)
    .update({ is_pinned: !(data?.is_pinned as boolean) })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/budget");
  revalidatePath("/");
  return { success: true };
}

export async function bulkAssign(
  assignments: { type: "category" | "group"; id: string; amountCents: number }[],
  month: string,
) {
  const supabase = await createClient();
  await Promise.all(
    assignments.map(({ type, id, amountCents }) =>
      type === "category"
        ? upsertCategoryBudget(supabase, { categoryId: id, month, assignedCents: amountCents })
        : upsertGroupBudget(supabase, { groupId: id, month, assignedCents: amountCents }),
    ),
  );
  revalidatePath("/budget");
  return { success: true };
}

export async function createGroup(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const budgetMode = (formData.get("budgetMode") as string) || "category";
  if (!name) return { error: "Group name is required" };
  if (budgetMode !== "category" && budgetMode !== "group")
    return { error: "Invalid budget mode" };

  const supabase = await createClient();
  const planId = await getActivePlanId(supabase);
  // New groups go to the end of the order.
  const { data: last } = await supabase
    .from("category_groups")
    .select("sort_index")
    .order("sort_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortIndex = (last?.sort_index ?? -1) + 1;

  const { data: created, error } = await supabase
    .from("category_groups")
    .insert({ name, budget_mode: budgetMode, sort_index: sortIndex, plan_id: planId })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/budget");
  return { success: true, id: created.id as string };
}

export async function createCategory(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const groupId = formData.get("groupId") as string;
  if (!name) return { error: "Category name is required" };
  if (!groupId) return { error: "Group is required" };

  const supabase = await createClient();
  // New categories go to the end of their group's order.
  const { data: last } = await supabase
    .from("categories")
    .select("sort_index")
    .eq("group_id", groupId)
    .order("sort_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortIndex = (last?.sort_index ?? -1) + 1;

  const { data: created, error } = await supabase
    .from("categories")
    .insert({ name, group_id: groupId, sort_index: sortIndex })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/budget");
  return { success: true, id: created.id as string };
}

export async function reorderGroups(orderedIds: string[]) {
  if (orderedIds.length === 0) return { success: true };
  const supabase = await createClient();
  const { error } = await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("category_groups").update({ sort_index: i }).eq("id", id),
    ),
  ).then((results) => ({ error: results.find((r) => r.error)?.error }));

  if (error) return { error: error.message };
  revalidatePath("/budget");
  return { success: true };
}

export async function reorderCategories(groupId: string, orderedIds: string[]) {
  if (orderedIds.length === 0) return { success: true };
  const supabase = await createClient();
  const { error } = await Promise.all(
    orderedIds.map((id, i) =>
      supabase
        .from("categories")
        .update({ sort_index: i })
        .eq("id", id)
        .eq("group_id", groupId),
    ),
  ).then((results) => ({ error: results.find((r) => r.error)?.error }));

  if (error) return { error: error.message };
  revalidatePath("/budget");
  return { success: true };
}

export async function renameCategory(categoryId: string, name: string) {
  const trimmed = name?.trim();
  if (!trimmed) return { error: "Category name is required" };
  if (!categoryId) return { error: "Category is required" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ name: trimmed })
    .eq("id", categoryId)
    .is("role", null); // exclude the Ready to Assign system category

  if (error) return { error: error.message };
  revalidatePath("/budget");
  revalidatePath("/");
  return { success: true };
}

export async function renameGroup(groupId: string, name: string) {
  const trimmed = name?.trim();
  if (!trimmed) return { error: "Group name is required" };
  if (!groupId) return { error: "Group is required" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("category_groups")
    .update({ name: trimmed })
    .eq("id", groupId);

  if (error) return { error: error.message };
  revalidatePath("/budget");
  revalidatePath("/");
  return { success: true };
}

export async function upsertTarget(
  entityId: string,
  entityType: "category" | "group",
  type: "fill_up_to" | "set_aside" | "by_date",
  amountCents: number,
  targetDate: string | null,
  repeatIntervalMonths: number | null = null,
) {
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    return { error: "Amount must be a positive integer (cents)" };
  if (type === "by_date" && !targetDate)
    return { error: "Target date is required for by_date type" };
  if (repeatIntervalMonths !== null) {
    if (type !== "by_date")
      return { error: "Repeat interval only applies to by_date targets" };
    if (!Number.isInteger(repeatIntervalMonths) || repeatIntervalMonths <= 0)
      return { error: "Repeat interval must be a positive number of months" };
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("targets")
    .select("id")
    .eq(entityType === "category" ? "category_id" : "group_id", entityId)
    .maybeSingle();

  const row = {
    type,
    amount_cents: amountCents,
    target_date: targetDate,
    repeat_interval_months: repeatIntervalMonths,
  };

  if (existing) {
    const { error } = await supabase.from("targets").update(row).eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("targets").insert({
      [entityType === "category" ? "category_id" : "group_id"]: entityId,
      ...row,
    });
    if (error) return { error: error.message };
  }

  revalidatePath("/budget");
  return { success: true };
}

export async function deleteTarget(
  entityId: string,
  entityType: "category" | "group",
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("targets")
    .delete()
    .eq(entityType === "category" ? "category_id" : "group_id", entityId);

  if (error) return { error: error.message };
  revalidatePath("/budget");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Income sources — informational only (see docs/budgeting-app-architecture.md).
// Never feed Ready to Assign or any budget math; just a name + monthly amount
// summed for the Spending Plan wizard's "planned income" figure.
// ---------------------------------------------------------------------------

export async function listIncomeSources() {
  const supabase = await createClient();
  const planId = await getActivePlanId(supabase);
  const { data, error } = await supabase
    .from("income_sources")
    .select("id, name, monthly_amount_cents, sort_index")
    .eq("plan_id", planId)
    .order("sort_index");

  if (error) return { error: error.message };
  return {
    success: true,
    data: (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      monthlyAmountCents: row.monthly_amount_cents as number,
    })),
  };
}

export async function upsertIncomeSource(input: {
  id?: string;
  name: string;
  monthlyAmountCents: number;
}) {
  const name = input.name?.trim();
  if (!name) return { error: "Name is required" };
  if (!Number.isInteger(input.monthlyAmountCents) || input.monthlyAmountCents < 0)
    return { error: "Amount must be a non-negative integer (cents)" };

  const supabase = await createClient();

  if (input.id) {
    const { error } = await supabase
      .from("income_sources")
      .update({ name, monthly_amount_cents: input.monthlyAmountCents })
      .eq("id", input.id);
    if (error) return { error: error.message };
    revalidatePath("/budget");
    return { success: true, id: input.id };
  }

  const planId = await getActivePlanId(supabase);
  const { data: last } = await supabase
    .from("income_sources")
    .select("sort_index")
    .eq("plan_id", planId)
    .order("sort_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortIndex = (last?.sort_index ?? -1) + 1;

  const { data: created, error } = await supabase
    .from("income_sources")
    .insert({
      name,
      monthly_amount_cents: input.monthlyAmountCents,
      plan_id: planId,
      sort_index: sortIndex,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/budget");
  return { success: true, id: created.id as string };
}

export async function deleteIncomeSource(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("income_sources").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/budget");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Spending Plan wizard — bulk-creates income sources, categories/groups, and
// targets from a guided flow (see components/budget/spending-plan-wizard.tsx).
// Reuses upsertTarget/bulkAssign/upsertIncomeSource above rather than
// duplicating their validation or write logic.
// ---------------------------------------------------------------------------

export type SpendingPlanExpenseLineInput = {
  category:
    | { kind: "existing"; id: string }
    | { kind: "new"; name: string; groupId: string }
    | {
        kind: "newGroup";
        name: string;
        newGroupName: string;
        newGroupBudgetMode: "category" | "group";
      };
  type: "fill_up_to" | "set_aside" | "by_date";
  amountCents: number;
  targetDate: string | null;
  repeatIntervalMonths: number | null;
  // One-time current-month assignment of the full amount, for the
  // "sinking fund" pattern (front-load the category, then let the recurring
  // by_date target's shortfall-spreading math handle monthly replenishment).
  fundInFullNow: boolean;
};

const MONTH_RE = /^\d{4}-\d{2}-01$/;

export async function applySpendingPlan(input: {
  incomeSources: { id?: string; name: string; monthlyAmountCents: number }[];
  expenseLines: SpendingPlanExpenseLineInput[];
  month: string;
}) {
  if (!MONTH_RE.test(input.month)) return { error: "Invalid month" };

  const supabase = await createClient();
  const planId = await getActivePlanId(supabase);

  for (const source of input.incomeSources) {
    const result = await upsertIncomeSource(source);
    if (result?.error) return { error: `Income source "${source.name}": ${result.error}` };
  }

  // Category-group budget mode, cached per group so repeated lines in the
  // same group (or the same new group) don't re-query it.
  const groupModeCache = new Map<string, "category" | "group">();

  // Sum amounts per (entityType, entityId) so multiple lines landing on the
  // same group-budgeted group's shared target/assignment (see below) don't
  // clobber each other — the last upsertTarget call would otherwise just
  // overwrite the prior one, and bulkAssign's separate calls would race.
  const assignmentTotals = new Map<string, { type: "category" | "group"; id: string; amountCents: number }>();

  for (const line of input.expenseLines) {
    let categoryId: string;
    let groupId: string;

    if (line.category.kind === "existing") {
      const { data: cat, error } = await supabase
        .from("categories")
        .select("id, group_id, category_groups(budget_mode)")
        .eq("id", line.category.id)
        .single();
      if (error || !cat) return { error: "Category not found" };
      categoryId = cat.id as string;
      groupId = cat.group_id as string;
      const mode = (cat.category_groups as unknown as { budget_mode: "category" | "group" } | null)
        ?.budget_mode;
      groupModeCache.set(groupId, mode ?? "category");
    } else if (line.category.kind === "new") {
      const name = line.category.name.trim();
      if (!name) return { error: "Category name is required" };
      const { data: created, error } = await supabase
        .from("categories")
        .insert({ name, group_id: line.category.groupId })
        .select("id")
        .single();
      if (error || !created) return { error: error?.message ?? "Failed to create category" };
      categoryId = created.id as string;
      groupId = line.category.groupId;
      if (!groupModeCache.has(groupId)) {
        const { data: g } = await supabase
          .from("category_groups")
          .select("budget_mode")
          .eq("id", groupId)
          .single();
        groupModeCache.set(groupId, (g?.budget_mode as "category" | "group") ?? "category");
      }
    } else {
      const groupName = line.category.newGroupName.trim();
      const name = line.category.name.trim();
      if (!groupName) return { error: "Group name is required" };
      if (!name) return { error: "Category name is required" };
      const { data: newGroup, error: groupError } = await supabase
        .from("category_groups")
        .insert({
          name: groupName,
          budget_mode: line.category.newGroupBudgetMode,
          plan_id: planId,
        })
        .select("id")
        .single();
      if (groupError || !newGroup) return { error: groupError?.message ?? "Failed to create group" };
      groupId = newGroup.id as string;
      groupModeCache.set(groupId, line.category.newGroupBudgetMode);
      const { data: created, error } = await supabase
        .from("categories")
        .insert({ name, group_id: groupId })
        .select("id")
        .single();
      if (error || !created) return { error: error?.message ?? "Failed to create category" };
      categoryId = created.id as string;
    }

    // Individual categories in a group-budgeted group aren't independently
    // targetable/assignable (see GROUP BUDGETING RULES) — attach the target
    // and any front-load assignment to the group instead.
    const isGroupBudget = groupModeCache.get(groupId) === "group";
    const entityType: "category" | "group" = isGroupBudget ? "group" : "category";
    const entityId = isGroupBudget ? groupId : categoryId;

    const targetResult = await upsertTarget(
      entityId,
      entityType,
      line.type,
      line.amountCents,
      line.targetDate,
      line.repeatIntervalMonths,
    );
    if (targetResult?.error) return { error: targetResult.error };

    if (line.fundInFullNow) {
      const key = `${entityType}:${entityId}`;
      const existing = assignmentTotals.get(key);
      assignmentTotals.set(key, {
        type: entityType,
        id: entityId,
        amountCents: (existing?.amountCents ?? 0) + line.amountCents,
      });
    }
  }

  if (assignmentTotals.size > 0) {
    // bulkAssign's underlying writes throw LedgerError on failure rather than
    // returning { error }; surface that as a normal error response instead of
    // an unhandled server-action exception.
    try {
      await bulkAssign([...assignmentTotals.values()], input.month);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Failed to assign funds" };
    }
  }

  revalidatePath("/budget");
  return { success: true };
}
