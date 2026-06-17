"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createTransaction,
  createTransfer,
  deleteTransaction,
  deleteTransactionWithCounterpart,
  updateTransaction,
  LedgerError,
} from "@/lib/ledger";

type Allocation = { categoryId: string; amountCents: number };

function revalidateAll() {
  revalidatePath("/accounts");
  revalidatePath("/");
  revalidatePath("/budget");
}

/**
 * Unified create / edit / convert entry point for the shared transaction form.
 *
 * - No `txnId` → create.
 * - With `txnId` → edit (including changing amount, account, and category).
 * - `direction === "transfer"` with a `txnId` for a non-transfer → convert the
 *   single-sided transaction into a two-sided transfer (delete + recreate).
 */
export async function saveTransaction(formData: FormData) {
  const txnId = (formData.get("txnId") as string) || null;
  const direction = (formData.get("direction") as string) || "outflow";
  const accountId = formData.get("accountId") as string;
  const txnDate = formData.get("txnDate") as string;
  const payee = (formData.get("payee") as string)?.trim() || "";
  const memo = (formData.get("memo") as string)?.trim() || null;
  const cleared = formData.get("cleared") === "true";
  const rawAmount = formData.get("amount") as string;

  if (!accountId) return { error: "Account is required" };
  if (!txnDate) return { error: "Date is required" };
  if (!rawAmount) return { error: "Amount is required" };

  const absAmount = Math.round(parseFloat(rawAmount) * 100);
  if (isNaN(absAmount) || absAmount <= 0) return { error: "Invalid amount" };

  const supabase = await createClient();
  const now = new Date().toISOString();
  const clearedAt = cleared ? now : null;

  // ---- Transfer (incl. converting an existing outflow/inflow) ----
  if (direction === "transfer") {
    const toAccountId = formData.get("toAccountId") as string;
    if (!toAccountId) return { error: "To account is required" };
    if (toAccountId === accountId)
      return { error: "From and To accounts must differ" };

    try {
      // Converting an existing single-sided line: drop it and recreate as a
      // proper two-sided transfer. transaction_allocations cascade on delete.
      if (txnId) {
        await deleteTransaction(supabase, txnId);
      }
      await createTransfer(supabase, {
        fromAccountId: accountId,
        toAccountId,
        amountCents: absAmount,
        txnDate,
        memo: memo || undefined,
        clearedAt,
      });
      revalidateAll();
      return { success: true };
    } catch (e) {
      if (e instanceof LedgerError) return { error: e.message };
      return { error: "Failed to save transfer" };
    }
  }

  // ---- Outflow / inflow ----
  const amountCents = direction === "inflow" ? absAmount : -absAmount;

  let allocations: Allocation[];
  try {
    allocations = JSON.parse((formData.get("allocations") as string) || "[]");
  } catch {
    return { error: "Invalid allocations" };
  }

  if (allocations.length > 0) {
    const sum = allocations.reduce((s, a) => s + a.amountCents, 0);
    if (sum !== amountCents) {
      return { error: "Split amounts must add up to the transaction total." };
    }
  }

  const hasAllocations = allocations.length > 0;

  try {
    if (txnId) {
      // An empty allocations array un-approves the transaction (back to pending).
      await updateTransaction(supabase, {
        id: txnId,
        accountId,
        amountCents,
        txnDate,
        payee,
        memo,
        clearedAt,
        approvedAt: hasAllocations ? now : null,
        allocations,
      });
    } else {
      await createTransaction(supabase, {
        accountId,
        amountCents,
        txnDate,
        payee,
        memo: memo || undefined,
        clearedAt,
        approvedAt: hasAllocations ? now : null,
        allocations: hasAllocations ? allocations : undefined,
      });
    }
    revalidateAll();
    return { success: true };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return { error: "Failed to save transaction" };
  }
}

/**
 * Permanently delete a transaction. When the transaction is one leg of a
 * transfer, the matching mirror leg is removed too. Splits cascade in the DB.
 */
export async function deleteTransactionAction(txnId: string) {
  if (!txnId) return { error: "Transaction is required" };

  const supabase = await createClient();
  try {
    await deleteTransactionWithCounterpart(supabase, txnId);
    revalidateAll();
    return { success: true };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return { error: "Failed to delete transaction" };
  }
}
