import type { SupabaseClient } from "@supabase/supabase-js";

import { LedgerError } from "./errors";
import {
  approximateAvailableCents,
  sumClearedTransactionAmounts,
  sumPendingTransactionAmounts,
} from "./balance";
import {
  OPENING_BALANCE_IMPORTED_ID,
  OPENING_BALANCE_PAYEE,
} from "./constants";
import {
  RECONCILIATION_FIX_HINT,
  checkReconciliation,
} from "./reconciliation";
import type {
  AccountBalanceSummary,
  AccountType,
  AllocationRow,
  CreateAccountInput,
  CreateOpeningBalanceInput,
  CreateTransactionInput,
  CreateTransferInput,
  ReconciliationCheckInput,
  ReconciliationCheckResult,
  TransactionAllocationInput,
  TransactionAmountLine,
  TransactionRow,
  UpdateTransactionInput,
  UpsertTransactionInput,
} from "./types";
import {
  assertNonZeroAmount,
  assertPositiveAmount,
  assertTxnDate,
  validateAllocations,
  validateCreditAccount,
  validateTransferAccounts,
} from "./validation";

// Delegates to ledger_replace_allocations RPC so the DELETE + INSERT run in one
// PostgreSQL transaction, keeping the deferred split-sum constraint satisfied.
async function replaceAllocations(
  client: SupabaseClient,
  transactionId: string,
  allocations: TransactionAllocationInput[],
): Promise<void> {
  const { error } = await client.rpc("ledger_replace_allocations", {
    p_transaction_id: transactionId,
    p_allocations: allocations.map((a) => ({
      category_id: a.categoryId,
      amount_cents: a.amountCents,
    })),
  });
  if (error) throw new LedgerError("db_error", error.message);
}

// Updates amount_cents and replaces all allocations atomically so neither the
// deferred allocation-sum trigger nor the (also-deferred) transaction-level
// trigger ever sees a temporarily-inconsistent state.
async function updateAmountAndAllocations(
  client: SupabaseClient,
  transactionId: string,
  amountCents: number,
  allocations: TransactionAllocationInput[],
): Promise<void> {
  const { error } = await client.rpc("ledger_update_amount_and_allocations", {
    p_transaction_id: transactionId,
    p_amount_cents: amountCents,
    p_allocations: allocations.map((a) => ({
      category_id: a.categoryId,
      amount_cents: a.amountCents,
    })),
  });
  if (error) throw new LedgerError("db_error", error.message);
}

function mapTransactionRow(row: TransactionRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    amountCents: row.amount_cents,
    txnDate: row.txn_date,
    payee: row.payee,
    memo: row.memo,
    transferAccountId: row.transfer_account_id,
    importedId: row.imported_id,
    approvedAt: row.approved_at,
    clearedAt: row.cleared_at,
    reconciledAt: row.reconciled_at,
    createdAt: row.created_at,
  };
}

/**
 * Import/sync entry point: dedupe by (account_id, imported_id), replace splits on update.
 * See docs/budgeting-app-architecture.md § TRANSACTION API.
 */
export async function upsertTransaction(
  client: SupabaseClient,
  input: UpsertTransactionInput,
) {
  assertNonZeroAmount(input.amountCents);
  assertTxnDate(input.txnDate);
  validateAllocations(
    input.amountCents,
    input.allocations,
    input.approvedAt ?? null,
  );

  const { data: existing, error: lookupError } = await client
    .from("transactions")
    .select("id, amount_cents")
    .eq("account_id", input.accountId)
    .eq("imported_id", input.importedId)
    .maybeSingle();

  if (lookupError) {
    throw new LedgerError("db_error", lookupError.message);
  }

  const payload = {
    account_id: input.accountId,
    amount_cents: input.amountCents,
    txn_date: input.txnDate,
    payee: input.payee ?? "",
    memo: input.memo ?? null,
    transfer_account_id: input.transferAccountId ?? null,
    imported_id: input.importedId,
    cleared_at: input.clearedAt ?? null,
    approved_at: input.approvedAt ?? null,
  };

  if (existing) {
    const amountIsChanging = input.amountCents !== existing.amount_cents;

    // Replace allocations BEFORE touching approved_at or amount_cents so all
    // triggers see a consistent final state when they fire.
    if (input.allocations && input.allocations.length > 0) {
      if (amountIsChanging) {
        await updateAmountAndAllocations(
          client,
          existing.id,
          input.amountCents,
          input.allocations,
        );
      } else {
        await replaceAllocations(client, existing.id, input.allocations);
      }
    }

    // UPDATE remaining fields (amount_cents included; if already set by the
    // RPC the trigger sees OLD == NEW and skips the constraint check).
    const { data: updated, error: updateError } = await client
      .from("transactions")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (updateError) {
      throw new LedgerError("db_error", updateError.message);
    }

    return {
      created: false as const,
      transaction: mapTransactionRow(updated as TransactionRow),
    };
  }

  const { data: created, error: insertError } = await client
    .from("transactions")
    .insert(payload)
    .select("*")
    .single();

  if (insertError) {
    throw new LedgerError("db_error", insertError.message);
  }

  const row = created as TransactionRow;
  if (input.allocations && input.allocations.length > 0) {
    await replaceAllocations(client, row.id, input.allocations);
  }

  return {
    created: true as const,
    transaction: mapTransactionRow(row),
  };
}

export async function createTransaction(
  client: SupabaseClient,
  input: CreateTransactionInput,
) {
  assertNonZeroAmount(input.amountCents);
  assertTxnDate(input.txnDate);
  validateAllocations(
    input.amountCents,
    input.allocations,
    input.approvedAt ?? null,
  );

  const { data, error } = await client
    .from("transactions")
    .insert({
      account_id: input.accountId,
      amount_cents: input.amountCents,
      txn_date: input.txnDate,
      payee: input.payee ?? "",
      memo: input.memo ?? null,
      transfer_account_id: input.transferAccountId ?? null,
      cleared_at: input.clearedAt ?? null,
      approved_at: input.approvedAt ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new LedgerError("db_error", error.message);
  }

  const row = data as TransactionRow;
  if (input.allocations && input.allocations.length > 0) {
    await replaceAllocations(client, row.id, input.allocations);
  }

  return mapTransactionRow(row);
}

export async function updateTransaction(
  client: SupabaseClient,
  input: UpdateTransactionInput,
) {
  const { data: existing, error: fetchError } = await client
    .from("transactions")
    .select("*")
    .eq("id", input.id)
    .single();

  if (fetchError || !existing) {
    throw new LedgerError(
      "not_found",
      fetchError?.message ?? "transaction not found",
    );
  }

  const current = existing as TransactionRow;
  const amountCents = input.amountCents ?? current.amount_cents;
  const approvedAt =
    input.approvedAt !== undefined ? input.approvedAt : current.approved_at;

  assertNonZeroAmount(amountCents);
  if (input.txnDate) {
    assertTxnDate(input.txnDate);
  }

  // Require allocations only when the caller is doing something that makes the
  // current DB allocations invalid: approving for the first time, or changing
  // the amount on an already-approved transaction.  A simple payee/memo edit on
  // an approved transaction must not be forced to re-specify all allocations.
  const isApproving =
    input.approvedAt !== undefined &&
    input.approvedAt !== null &&
    current.approved_at === null;
  const isChangingAmountOnApproved =
    input.amountCents !== undefined &&
    input.amountCents !== current.amount_cents &&
    current.approved_at !== null;

  validateAllocations(
    amountCents,
    input.allocations,
    isApproving || isChangingAmountOnApproved ? approvedAt : null,
  );

  const amountIsChanging =
    input.amountCents !== undefined &&
    input.amountCents !== current.amount_cents;

  // Replace allocations BEFORE updating the transaction row so all triggers see
  // a consistent final state (allocations already match the new amount/approval
  // by the time approved_at or amount_cents is committed).
  if (input.allocations !== undefined) {
    if (amountIsChanging && input.allocations.length > 0) {
      await updateAmountAndAllocations(
        client,
        input.id,
        input.amountCents!,
        input.allocations,
      );
    } else {
      await replaceAllocations(client, input.id, input.allocations);
    }
  }

  const patch: Record<string, unknown> = {};
  if (input.amountCents !== undefined) {
    // Safe to include even when the RPC already set it: trigger sees OLD == NEW
    // and skips the constraint check.
    patch.amount_cents = input.amountCents;
  }
  if (input.txnDate !== undefined) patch.txn_date = input.txnDate;
  if (input.payee !== undefined) patch.payee = input.payee;
  if (input.memo !== undefined) patch.memo = input.memo;
  if (input.transferAccountId !== undefined) {
    patch.transfer_account_id = input.transferAccountId;
  }
  if (input.clearedAt !== undefined) patch.cleared_at = input.clearedAt;
  if (input.approvedAt !== undefined) patch.approved_at = input.approvedAt;

  if (Object.keys(patch).length === 0) {
    const { data, error } = await client
      .from("transactions")
      .select("*")
      .eq("id", input.id)
      .single();
    if (error) throw new LedgerError("db_error", error.message);
    return mapTransactionRow(data as TransactionRow);
  }

  const { data: updated, error: updateError } = await client
    .from("transactions")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();

  if (updateError) {
    throw new LedgerError("db_error", updateError.message);
  }

  return mapTransactionRow(updated as TransactionRow);
}

export async function deleteTransaction(
  client: SupabaseClient,
  transactionId: string,
) {
  const { error } = await client
    .from("transactions")
    .delete()
    .eq("id", transactionId);

  if (error) {
    throw new LedgerError("db_error", error.message);
  }
}

export async function createTransfer(
  client: SupabaseClient,
  input: CreateTransferInput,
) {
  assertPositiveAmount(input.amountCents);
  assertTxnDate(input.txnDate);
  validateTransferAccounts(input.fromAccountId, input.toAccountId);

  const { data, error } = await client.rpc("ledger_create_transfer", {
    p_from_account_id: input.fromAccountId,
    p_to_account_id: input.toAccountId,
    p_amount_cents: input.amountCents,
    p_txn_date: input.txnDate,
    p_payee: input.payee ?? "Transfer",
    p_memo: input.memo ?? null,
    p_cleared_at: input.clearedAt ?? null,
  });

  if (error) {
    throw new LedgerError("db_error", error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new LedgerError("db_error", "transfer RPC returned no rows");
  }

  return {
    outflowTransactionId: row.outflow_transaction_id as string,
    inflowTransactionId: row.inflow_transaction_id as string,
  };
}

export async function getReadyToAssignCategoryId(
  client: SupabaseClient,
): Promise<string> {
  const { data, error } = await client
    .from("categories")
    .select("id")
    .eq("role", "ready_to_assign")
    .maybeSingle();

  if (error) {
    throw new LedgerError("db_error", error.message);
  }
  if (!data) {
    throw new LedgerError(
      "ready_to_assign_missing",
      "Ready to Assign category not found",
    );
  }

  return data.id as string;
}

/**
 * One cleared, approved line per account (`imported_id` crest:opening_balance)
 * with a split to Ready to Assign — register baseline for reconcile and RTA.
 */
export async function createOpeningBalance(
  client: SupabaseClient,
  input: CreateOpeningBalanceInput,
) {
  if (!Number.isInteger(input.amountCents)) {
    throw new LedgerError(
      "invalid_cents",
      "amountCents must be an integer",
    );
  }
  if (input.amountCents === 0) {
    throw new LedgerError(
      "invalid_amount",
      "opening balance amount cannot be zero",
    );
  }

  const txnDate = input.txnDate ?? new Date().toISOString().slice(0, 10);
  const readyToAssignId = await getReadyToAssignCategoryId(client);
  const clearedAt = new Date().toISOString();

  const result = await upsertTransaction(client, {
    accountId: input.accountId,
    amountCents: input.amountCents,
    txnDate,
    payee: OPENING_BALANCE_PAYEE,
    memo: null,
    importedId: OPENING_BALANCE_IMPORTED_ID,
    clearedAt,
    approvedAt: clearedAt,
    allocations: [
      {
        categoryId: readyToAssignId,
        amountCents: input.amountCents,
      },
    ],
  });

  return result.transaction;
}

export async function createAccount(
  client: SupabaseClient,
  input: CreateAccountInput,
) {
  validateCreditAccount(input.type, input.paymentCategoryId);

  const openingBalance = input.openingBalanceCents ?? 0;
  if (!Number.isInteger(openingBalance)) {
    throw new LedgerError(
      "invalid_cents",
      "openingBalanceCents must be an integer",
    );
  }

  const { data, error } = await client
    .from("accounts")
    .insert({
      name: input.name,
      type: input.type,
      balance_cents: openingBalance,
      payment_category_id: input.paymentCategoryId ?? null,
      is_linked: input.isLinked ?? false,
    })
    .select("*")
    .single();

  if (error) {
    throw new LedgerError("db_error", error.message);
  }

  const account = mapAccountRow(data);

  if (openingBalance !== 0) {
    await createOpeningBalance(client, {
      accountId: account.id,
      amountCents: openingBalance,
    });
  }

  return account;
}

function mapAccountRow(data: Record<string, unknown>) {
  return {
    id: data.id as string,
    name: data.name as string,
    type: data.type as AccountType,
    balanceCents: data.balance_cents as number,
    paymentCategoryId: data.payment_category_id as string | null,
    isLinked: data.is_linked as boolean,
    isActive: data.is_active as boolean,
    createdAt: data.created_at as string,
  };
}

/**
 * Update last bank-reported cleared balance (map Plaid `accounts.balance.current`).
 */
export async function syncBankClearedBalance(
  client: SupabaseClient,
  accountId: string,
  bankClearedBalanceCents: number,
) {
  if (!Number.isInteger(bankClearedBalanceCents)) {
    throw new LedgerError(
      "invalid_cents",
      "bankClearedBalanceCents must be an integer",
    );
  }

  const { data, error } = await client
    .from("accounts")
    .update({ balance_cents: bankClearedBalanceCents })
    .eq("id", accountId)
    .select("*")
    .single();

  if (error || !data) {
    throw new LedgerError(
      "db_error",
      error?.message ?? "failed to update bank cleared balance",
    );
  }

  return mapAccountRow(data);
}

export async function getAccount(
  client: SupabaseClient,
  accountId: string,
) {
  const { data, error } = await client
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (error || !data) {
    throw new LedgerError(
      "not_found",
      error?.message ?? "account not found",
    );
  }

  return mapAccountRow(data);
}

export async function listAccounts(client: SupabaseClient) {
  const { data, error } = await client
    .from("accounts")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) {
    throw new LedgerError("db_error", error.message);
  }

  return (data ?? []).map((row) => mapAccountRow(row));
}

async function loadTransactionAmountLines(
  client: SupabaseClient,
  accountId: string,
): Promise<TransactionAmountLine[]> {
  const { data, error } = await client
    .from("transactions")
    .select("amount_cents, cleared_at")
    .eq("account_id", accountId);

  if (error) {
    throw new LedgerError("db_error", error.message);
  }

  return (data ?? []).map((row) => ({
    amountCents: row.amount_cents as number,
    clearedAt: row.cleared_at as string | null,
  }));
}

export async function getAccountBalanceSummary(
  client: SupabaseClient,
  accountId: string,
): Promise<AccountBalanceSummary> {
  const account = await getAccount(client, accountId);
  const transactions = await loadTransactionAmountLines(client, accountId);
  const pendingActivityCents = sumPendingTransactionAmounts(transactions);

  return {
    bankClearedBalanceCents: account.balanceCents,
    registerClearedBalanceCents: sumClearedTransactionAmounts(transactions),
    pendingActivityCents,
    approximateAvailableCents: approximateAvailableCents(
      account.balanceCents,
      transactions,
    ),
  };
}

export async function buildReconciliationCheck(
  client: SupabaseClient,
  accountId: string,
): Promise<ReconciliationCheckInput> {
  const account = await getAccount(client, accountId);
  const transactions = await loadTransactionAmountLines(client, accountId);

  return {
    bankClearedBalanceCents: account.balanceCents,
    transactions,
  };
}

export function evaluateReconciliation(
  input: ReconciliationCheckInput,
): ReconciliationCheckResult {
  return checkReconciliation(input);
}

/**
 * When bank cleared balance matches sum of cleared register lines, mark them reconciled.
 */
export async function applyReconciliation(
  client: SupabaseClient,
  accountId: string,
  input?: ReconciliationCheckInput,
) {
  const checkInput =
    input ?? (await buildReconciliationCheck(client, accountId));
  const result = checkReconciliation(checkInput);
  if (!result.ok) {
    throw new LedgerError(
      "reconciliation_mismatch",
      `Bank cleared balance (${result.bankClearedBalanceCents}) does not match register (${result.registerClearedBalanceCents}); difference ${result.differenceCents} cents. ${RECONCILIATION_FIX_HINT}`,
    );
  }

  const now = new Date().toISOString();
  const { error } = await client
    .from("transactions")
    .update({ reconciled_at: now })
    .eq("account_id", accountId)
    .not("cleared_at", "is", null)
    .is("reconciled_at", null);

  if (error) {
    throw new LedgerError("db_error", error.message);
  }

  return { reconciledAt: now };
}

export async function getTransactionAllocations(
  client: SupabaseClient,
  transactionId: string,
) {
  const { data, error } = await client
    .from("transaction_allocations")
    .select("*")
    .eq("transaction_id", transactionId);

  if (error) {
    throw new LedgerError("db_error", error.message);
  }

  return (data as AllocationRow[]).map((row) => ({
    id: row.id,
    transactionId: row.transaction_id,
    categoryId: row.category_id,
    amountCents: row.amount_cents,
  }));
}
