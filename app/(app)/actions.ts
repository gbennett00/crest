"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { updateTransaction } from "@/lib/ledger";

export async function approveWithCategory(
  transactionId: string,
  categoryId: string,
) {
  const supabase = await createClient();

  const { data: txn, error } = await supabase
    .from("transactions")
    .select("amount_cents")
    .eq("id", transactionId)
    .single();

  if (error || !txn) return { error: "Transaction not found" };

  try {
    await updateTransaction(supabase, {
      id: transactionId,
      approvedAt: new Date().toISOString(),
      allocations: [{ categoryId, amountCents: txn.amount_cents as number }],
    });
    revalidatePath("/");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to approve" };
  }
}
