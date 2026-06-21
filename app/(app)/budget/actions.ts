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

  const { error } = await supabase
    .from("category_groups")
    .insert({ name, budget_mode: budgetMode, sort_index: sortIndex, plan_id: planId });

  if (error) return { error: error.message };
  revalidatePath("/budget");
  return { success: true };
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

  const { error } = await supabase
    .from("categories")
    .insert({ name, group_id: groupId, sort_index: sortIndex });

  if (error) return { error: error.message };
  revalidatePath("/budget");
  return { success: true };
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
) {
  if (!Number.isInteger(amountCents) || amountCents <= 0)
    return { error: "Amount must be a positive integer (cents)" };
  if (type === "by_date" && !targetDate)
    return { error: "Target date is required for by_date type" };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("targets")
    .select("id")
    .eq(entityType === "category" ? "category_id" : "group_id", entityId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("targets")
      .update({ type, amount_cents: amountCents, target_date: targetDate })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("targets").insert({
      [entityType === "category" ? "category_id" : "group_id"]: entityId,
      type,
      amount_cents: amountCents,
      target_date: targetDate,
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
