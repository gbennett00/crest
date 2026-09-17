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
  // "layout" covers both /accounts and the dynamic /accounts/[id] register.
  revalidatePath("/accounts", "layout");
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

  // Tracking accounts are never categorized — the form hides the category
  // field for them, so always approve immediately with no allocation rather
  // than reading "no category" as "leave pending" (that reading is correct
  // for on-budget accounts, where it means "approve later").
  const { data: acctRow } = await supabase
    .from("accounts")
    .select("on_budget")
    .eq("id", accountId)
    .single();
  const onBudget = (acctRow as { on_budget: boolean } | null)?.on_budget ?? true;
  const approvedAt = onBudget ? (hasAllocations ? now : null) : now;
  const finalAllocations = onBudget ? allocations : [];

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
        approvedAt,
        allocations: finalAllocations,
        accountOnBudget: onBudget,
      });
    } else {
      await createTransaction(supabase, {
        accountId,
        amountCents,
        txnDate,
        payee,
        memo: memo || undefined,
        clearedAt,
        accountOnBudget: onBudget,
        approvedAt,
        allocations: onBudget && hasAllocations ? allocations : undefined,
      });
    }
    revalidateAll();
    return { success: true };
  } catch (e) {
    if (e instanceof LedgerError) return { error: e.message };
    return { error: "Failed to save transaction" };
  }
}

// ---------------------------------------------------------------------------
// Bulk editing
// ---------------------------------------------------------------------------

/**
 * Shared result shape for the bulk actions. `updated` counts transactions that
 * were changed; `skipped` counts those left untouched because they can't safely
 * take the operation (reconciled lines, transfer legs, or — for approve — an
 * uncategorized line with no category to fall back on).
 */
export type BulkResult = {
  updated: number;
  skipped: number;
  error?: string;
};

type BulkTxnRow = {
  id: string;
  amount_cents: number;
  approved_at: string | null;
  reconciled_at: string | null;
  transfer_account_id: string | null;
  transaction_allocations: { category_id: string; amount_cents: number }[];
};

async function loadBulkTxns(
  supabase: Awaited<ReturnType<typeof createClient>>,
  txnIds: string[],
): Promise<BulkTxnRow[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, amount_cents, approved_at, reconciled_at, transfer_account_id, transaction_allocations(category_id, amount_cents)",
    )
    .in("id", txnIds);
  if (error) throw new LedgerError("db_error", error.message);
  return (data ?? []) as unknown as BulkTxnRow[];
}

function existingAllocations(row: BulkTxnRow): Allocation[] {
  return (row.transaction_allocations ?? []).map((a) => ({
    categoryId: a.category_id,
    amountCents: a.amount_cents,
  }));
}

function allocationsCoverAmount(row: BulkTxnRow): boolean {
  const allocs = row.transaction_allocations ?? [];
  if (allocs.length === 0) return false;
  const sum = allocs.reduce((s, a) => s + a.amount_cents, 0);
  return sum === row.amount_cents;
}

/**
 * Approve a batch of transactions. A line that already carries splits summing
 * to its amount keeps them; an uncategorized line is given the single fallback
 * `categoryId` (full amount) so it can be approved in one gesture, mirroring the
 * per-row Approve control. Reconciled lines can be approved (locking concerns
 * amount/cleared state, not categorization). An already-approved transfer leg
 * is skipped — it carries no category and was created that way on purpose.
 * A still-*pending* transfer leg (the on-budget side of a mixed on-budget /
 * tracking-account transfer — see ledger_create_transfer) is not skipped: it
 * needs a category exactly like a normal uncategorized line. An uncategorized
 * line is skipped when no fallback category is supplied.
 */
export async function bulkApproveTransactions(
  txnIds: string[],
  categoryId: string | null,
): Promise<BulkResult> {
  if (txnIds.length === 0) return { updated: 0, skipped: 0 };

  const supabase = await createClient();
  const now = new Date().toISOString();

  try {
    const rows = await loadBulkTxns(supabase, txnIds);
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      if (row.transfer_account_id && row.approved_at) {
        skipped++;
        continue;
      }

      let allocations: Allocation[];
      if (allocationsCoverAmount(row)) {
        allocations = existingAllocations(row);
      } else if (categoryId) {
        allocations = [{ categoryId, amountCents: row.amount_cents }];
      } else {
        // Uncategorized and no fallback category to apply — can't approve.
        skipped++;
        continue;
      }

      await updateTransaction(supabase, {
        id: row.id,
        approvedAt: now,
        allocations,
      });
      updated++;
    }

    revalidateAll();
    return { updated, skipped };
  } catch (e) {
    if (e instanceof LedgerError) return { updated: 0, skipped: 0, error: e.message };
    return { updated: 0, skipped: 0, error: "Failed to approve transactions" };
  }
}

/**
 * Assign a single category (full amount) to a batch of transactions. Approval
 * state is left as-is: an already-approved line stays approved with the new
 * single split; a pending line stays pending but becomes categorized.
 * Reconciled lines can be categorized; an already-approved transfer leg (no
 * category, created that way on purpose) is skipped. A still-pending transfer
 * leg — the on-budget side of a mixed on-budget/tracking-account transfer —
 * is categorized like any other pending line.
 */
export async function bulkCategorizeTransactions(
  txnIds: string[],
  categoryId: string,
): Promise<BulkResult> {
  if (txnIds.length === 0) return { updated: 0, skipped: 0 };
  if (!categoryId) return { updated: 0, skipped: 0, error: "Category is required" };

  const supabase = await createClient();

  try {
    const rows = await loadBulkTxns(supabase, txnIds);
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      if (row.transfer_account_id && row.approved_at) {
        skipped++;
        continue;
      }

      await updateTransaction(supabase, {
        id: row.id,
        allocations: [{ categoryId, amountCents: row.amount_cents }],
      });
      updated++;
    }

    revalidateAll();
    return { updated, skipped };
  } catch (e) {
    if (e instanceof LedgerError) return { updated: 0, skipped: 0, error: e.message };
    return { updated: 0, skipped: 0, error: "Failed to categorize transactions" };
  }
}

/**
 * Move a batch of transactions to a different account. Transfer legs are
 * skipped (moving one side would orphan its mirror) and reconciled lines are
 * skipped (locked). Lines already in the target account are a no-op skip.
 */
export async function bulkMoveTransactions(
  txnIds: string[],
  accountId: string,
): Promise<BulkResult> {
  if (txnIds.length === 0) return { updated: 0, skipped: 0 };
  if (!accountId) return { updated: 0, skipped: 0, error: "Account is required" };

  const supabase = await createClient();

  try {
    const rows = await loadBulkTxns(supabase, txnIds);
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      if (row.reconciled_at || row.transfer_account_id) {
        skipped++;
        continue;
      }

      await updateTransaction(supabase, {
        id: row.id,
        accountId,
      });
      updated++;
    }

    revalidateAll();
    return { updated, skipped };
  } catch (e) {
    if (e instanceof LedgerError) return { updated: 0, skipped: 0, error: e.message };
    return { updated: 0, skipped: 0, error: "Failed to move transactions" };
  }
}

/**
 * Permanently delete a batch of transactions. Each delete also removes the
 * mirror leg when the line is one side of a transfer (splits cascade in the
 * DB). Reconciled (locked) lines are skipped. This is irreversible — the UI
 * gates it behind a confirmation.
 */
export async function bulkDeleteTransactions(
  txnIds: string[],
): Promise<BulkResult> {
  if (txnIds.length === 0) return { updated: 0, skipped: 0 };

  const supabase = await createClient();

  try {
    const rows = await loadBulkTxns(supabase, txnIds);
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      if (row.reconciled_at) {
        skipped++;
        continue;
      }

      try {
        await deleteTransactionWithCounterpart(supabase, row.id);
        updated++;
      } catch (e) {
        // When both legs of a transfer are selected, deleting the first also
        // removes the second; reaching it here as "not found" means it's
        // already gone — a successful delete, not a failure.
        if (e instanceof LedgerError && e.code === "not_found") {
          updated++;
          continue;
        }
        throw e;
      }
    }

    revalidateAll();
    return { updated, skipped };
  } catch (e) {
    if (e instanceof LedgerError) return { updated: 0, skipped: 0, error: e.message };
    return { updated: 0, skipped: 0, error: "Failed to delete transactions" };
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
