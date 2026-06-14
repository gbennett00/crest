"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  applyReconciliation,
  createAccount,
  createTransaction,
  createTransfer,
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

export async function createManualTransaction(formData: FormData) {
  const accountId = formData.get("accountId") as string;
  const txnDate = formData.get("txnDate") as string;
  const payee = (formData.get("payee") as string)?.trim() || "";
  const memo = (formData.get("memo") as string)?.trim() || null;
  const rawAmount = formData.get("amount") as string;
  const direction = formData.get("direction") as string; // "inflow" | "outflow"
  const categoryId = (formData.get("categoryId") as string) || null;

  if (!accountId) return { error: "Account is required" };
  if (!txnDate) return { error: "Date is required" };
  if (!rawAmount) return { error: "Amount is required" };

  const absAmount = Math.round(parseFloat(rawAmount) * 100);
  if (isNaN(absAmount) || absAmount <= 0) return { error: "Invalid amount" };

  const amountCents = direction === "inflow" ? absAmount : -absAmount;

  const now = new Date().toISOString();
  const supabase = await createClient();

  try {
    await createTransaction(supabase, {
      accountId,
      amountCents,
      txnDate,
      payee,
      memo: memo || undefined,
      clearedAt: now,
      approvedAt: categoryId ? now : null,
      allocations: categoryId
        ? [{ categoryId, amountCents }]
        : undefined,
    });

    revalidatePath("/accounts");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return { error: "Failed to create transaction" };
  }
}

export async function createManualTransfer(formData: FormData) {
  const fromAccountId = formData.get("accountId") as string;
  const toAccountId = formData.get("toAccountId") as string;
  const txnDate = formData.get("txnDate") as string;
  const memo = (formData.get("memo") as string)?.trim() || null;
  const rawAmount = formData.get("amount") as string;

  if (!fromAccountId) return { error: "From account is required" };
  if (!toAccountId) return { error: "To account is required" };
  if (fromAccountId === toAccountId)
    return { error: "From and To accounts must differ" };
  if (!txnDate) return { error: "Date is required" };
  if (!rawAmount) return { error: "Amount is required" };

  const amountCents = Math.round(parseFloat(rawAmount) * 100);
  if (isNaN(amountCents) || amountCents <= 0)
    return { error: "Invalid amount" };

  const now = new Date().toISOString();
  const supabase = await createClient();

  try {
    // Two-sided transfer: outflow on the source account, matching inflow on the
    // destination. For a credit-card payment, From = bank, To = card.
    await createTransfer(supabase, {
      fromAccountId,
      toAccountId,
      amountCents,
      txnDate,
      memo: memo || undefined,
      clearedAt: now,
    });

    revalidatePath("/accounts");
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return { error: "Failed to create transfer" };
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
