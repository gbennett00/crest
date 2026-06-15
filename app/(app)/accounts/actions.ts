"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  applyReconciliation,
  createAccount,
  LedgerError,
  syncBankClearedBalance,
} from "@/lib/ledger";

export async function createManualAccount(formData: FormData) {
  const name = (formData.get("name") as string)?.trim();
  const type = formData.get("type") as "checking" | "savings" | "credit";
  const rawBalance = formData.get("openingBalance") as string;
  const paymentCategoryName =
    (formData.get("paymentCategoryName") as string)?.trim() ||
    `${name} Payment`;

  if (!name) return { error: "Account name is required" };
  if (!["checking", "savings", "credit"].includes(type))
    return { error: "Invalid account type" };

  const rawCents = rawBalance ? Math.round(parseFloat(rawBalance) * 100) : 0;
  if (isNaN(rawCents)) return { error: "Invalid opening balance" };
  // Credit card "balance owed" is entered as a positive number by the user but
  // represents debt — store and record it as a negative (outflow from the account).
  const openingBalanceCents = type === "credit" ? -rawCents : rawCents;

  const supabase = await createClient();

  try {
    let paymentCategoryId: string | null = null;

    if (type === "credit") {
      // Find or create the Credit Cards group
      const { data: existing } = await supabase
        .from("category_groups")
        .select("id")
        .eq("name", "Credit Cards")
        .maybeSingle();

      let groupId: string;
      if (existing) {
        groupId = existing.id as string;
      } else {
        const { data: newGroup, error: gErr } = await supabase
          .from("category_groups")
          .insert({ name: "Credit Cards", budget_mode: "category" })
          .select("id")
          .single();
        if (gErr) return { error: gErr.message };
        groupId = (newGroup as { id: string }).id;
      }

      const { data: cat, error: cErr } = await supabase
        .from("categories")
        .insert({ name: paymentCategoryName, group_id: groupId })
        .select("id")
        .single();
      if (cErr) return { error: cErr.message };
      paymentCategoryId = (cat as { id: string }).id;
    }

    await createAccount(supabase, {
      name,
      type,
      openingBalanceCents,
      paymentCategoryId,
    });

    revalidatePath("/accounts");
    return { success: true };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return { error: "Failed to create account" };
  }
}

export async function reconcileAccount(accountId: string) {
  const supabase = await createClient();
  try {
    const result = await applyReconciliation(supabase, accountId);
    revalidatePath("/accounts");
    return { success: true, reconciledAt: result.reconciledAt };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return { error: "Reconciliation failed" };
  }
}

export async function updateStatementBalance(
  accountId: string,
  balanceCents: number,
) {
  const supabase = await createClient();
  try {
    await syncBankClearedBalance(supabase, accountId, balanceCents);
    revalidatePath("/accounts");
    return { success: true };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return { error: "Failed to update balance" };
  }
}
