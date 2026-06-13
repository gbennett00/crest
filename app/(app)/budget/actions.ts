"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { upsertCategoryBudget, upsertGroupBudget } from "@/lib/ledger";

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
  const { error } = await supabase
    .from("category_groups")
    .insert({ name, budget_mode: budgetMode });

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
  const { error } = await supabase
    .from("categories")
    .insert({ name, group_id: groupId });

  if (error) return { error: error.message };
  revalidatePath("/budget");
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
