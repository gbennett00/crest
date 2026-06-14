"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { LedgerError } from "@/lib/ledger";

export async function saveTransaction(formData: FormData) {
  const txnId = formData.get("txnId") as string;
  const payee = (formData.get("payee") as string).trim();
  const txnDate = formData.get("txnDate") as string;
  const accountId = formData.get("accountId") as string;
  const memo = (formData.get("memo") as string).trim() || null;
  const cleared = formData.get("cleared") === "true";
  const amountCents = parseInt(formData.get("amountCents") as string, 10);

  if (!txnId || !txnDate || !accountId) {
    return { error: "Missing required fields" };
  }

  // Allocations are sent as a JSON array of { categoryId, amountCents }.
  // An empty array means "leave allocations as-is" (e.g. a still-pending txn).
  let allocations: { categoryId: string; amountCents: number }[];
  try {
    allocations = JSON.parse((formData.get("allocations") as string) || "[]");
  } catch {
    return { error: "Invalid allocations" };
  }

  if (allocations.length > 0) {
    const allocSum = allocations.reduce((sum, a) => sum + a.amountCents, 0);
    if (allocSum !== amountCents) {
      return { error: "Split amounts must add up to the transaction total." };
    }
  }

  const supabase = await createClient();

  try {
    const clearedAt = cleared ? new Date().toISOString() : null;

    // 1. Update simple fields (including account_id which updateTransaction doesn't support)
    const { error: txnErr } = await supabase
      .from("transactions")
      .update({
        payee,
        txn_date: txnDate,
        account_id: accountId,
        memo,
        cleared_at: clearedAt,
      })
      .eq("id", txnId);

    if (txnErr) throw new LedgerError("db_error", txnErr.message);

    // 2. Update allocations via RPC (handles deferred constraint correctly)
    if (allocations.length > 0) {
      const { error: allocErr } = await supabase.rpc("ledger_replace_allocations", {
        p_transaction_id: txnId,
        p_allocations: allocations.map((a) => ({
          category_id: a.categoryId,
          amount_cents: a.amountCents,
        })),
      });
      if (allocErr) throw new LedgerError("db_error", allocErr.message);
    }

    revalidatePath("/accounts");
    revalidatePath("/");
    revalidatePath("/budget");
    return { success: true };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return { error: "Failed to save transaction" };
  }
}
