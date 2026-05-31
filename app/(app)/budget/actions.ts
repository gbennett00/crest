"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { upsertCategoryBudget, upsertGroupBudget, getReadyToAssignCategoryId } from "@/lib/ledger";

// After any assignment, sync the RTA monthly_budget to -(sum of all non-RTA assignments).
// This makes computeAvailableThrough correctly reflect how much has been assigned away from RTA.
async function syncRtaBudget(supabase: Awaited<ReturnType<typeof createClient>>, month: string) {
  const rtaId = await getReadyToAssignCategoryId(supabase);

  const [catRes, grpRes] = await Promise.all([
    supabase
      .from("monthly_budgets")
      .select("assigned_cents")
      .eq("month", month)
      .not("category_id", "is", null)
      .neq("category_id", rtaId),
    supabase
      .from("monthly_budgets")
      .select("assigned_cents")
      .eq("month", month)
      .not("group_id", "is", null),
  ]);

  const totalAssigned =
    (catRes.data ?? []).reduce((s, r) => s + (r.assigned_cents as number), 0) +
    (grpRes.data ?? []).reduce((s, r) => s + (r.assigned_cents as number), 0);

  await upsertCategoryBudget(supabase, {
    categoryId: rtaId,
    month,
    assignedCents: -totalAssigned,
  });
}

export async function assignCategory(
  categoryId: string,
  month: string,
  assignedCents: number,
) {
  const supabase = await createClient();
  await upsertCategoryBudget(supabase, { categoryId, month, assignedCents });
  await syncRtaBudget(supabase, month);
  revalidatePath("/budget");
}

export async function assignGroup(
  groupId: string,
  month: string,
  assignedCents: number,
) {
  const supabase = await createClient();
  await upsertGroupBudget(supabase, { groupId, month, assignedCents });
  await syncRtaBudget(supabase, month);
  revalidatePath("/budget");
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
