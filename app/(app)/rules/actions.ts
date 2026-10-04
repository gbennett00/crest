"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActivePlanId } from "@/lib/plan/active-plan";
import {
  createCategoryRule,
  deleteCategoryRule,
  previewCategoryRule,
  resuggestPendingTransactions,
  updateCategoryRule,
  validateRuleInput,
  type CategoryRuleInput,
  type RulePreview,
} from "@/lib/category-rules";

// A rule change re-runs suggestions over pending transactions, which shows up
// on home and in every transaction list.
function revalidateAll() {
  revalidatePath("/accounts", "layout");
  revalidatePath("/");
  revalidatePath("/transactions");
}

type RuleResult = { error: string } | { error?: undefined; updatedPending: number };

/**
 * Re-applies suggestions to everything still pending so the new rule takes
 * effect immediately. A failure here doesn't undo the rule change, which
 * already landed — the next sync will apply it.
 */
async function resuggest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  planId: string,
): Promise<number> {
  try {
    return await resuggestPendingTransactions(supabase, planId);
  } catch (e) {
    console.error("[rules] re-suggesting pending transactions failed", e);
    return 0;
  }
}

export async function createRuleAction(input: CategoryRuleInput): Promise<RuleResult> {
  const invalid = validateRuleInput(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  try {
    const planId = await getActivePlanId(supabase);
    await createCategoryRule(supabase, planId, input);
    const updatedPending = await resuggest(supabase, planId);
    revalidateAll();
    return { updatedPending };
  } catch (e) {
    console.error("[rules] create failed", e);
    return { error: "Couldn’t save the rule." };
  }
}

export async function updateRuleAction(id: string, input: CategoryRuleInput): Promise<RuleResult> {
  const invalid = validateRuleInput(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  try {
    const planId = await getActivePlanId(supabase);
    await updateCategoryRule(supabase, id, input);
    const updatedPending = await resuggest(supabase, planId);
    revalidateAll();
    return { updatedPending };
  } catch (e) {
    console.error("[rules] update failed", e);
    return { error: "Couldn’t save the rule." };
  }
}

/** Deleting a rule leaves suggestions it already made in place. */
export async function deleteRuleAction(id: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  try {
    await deleteCategoryRule(supabase, id);
    revalidateAll();
    return {};
  } catch (e) {
    console.error("[rules] delete failed", e);
    return { error: "Couldn’t delete the rule." };
  }
}

/** Live "matches N past transactions" for the rule editor. */
export async function previewRuleAction(
  input: Omit<CategoryRuleInput, "categoryId">,
): Promise<RulePreview | null> {
  if (!input.matchText.trim()) return null;
  const supabase = await createClient();
  try {
    const planId = await getActivePlanId(supabase);
    return await previewCategoryRule(supabase, planId, input);
  } catch (e) {
    console.error("[rules] preview failed", e);
    return null;
  }
}
