import type { AccountBase, Transaction } from "plaid";

import type {
  AccountType,
  Cents,
  UpsertTransactionInput,
} from "@/lib/ledger/types";

/**
 * Plaid amounts are positive for outflows, negative for inflows — the exact
 * opposite of Crest's sign convention. Plaid amounts are floats in major
 * currency units (e.g. 12.34); Crest stores integer cents.
 */
export function plaidAmountToCents(amount: number): Cents {
  return -Math.round(amount * 100) || 0;
}

/**
 * Map Plaid account balance to Crest `balance_cents`.
 *
 * For depository accounts, Plaid `current` is positive and maps directly.
 * For credit accounts, Plaid `current` is the positive amount owed — Crest
 * stores credit balances as negative (debt is an outflow from the account).
 */
export function plaidBalanceToBalanceCents(account: AccountBase): Cents {
  const current = account.balances.current ?? 0;
  const cents = Math.round(current * 100);
  return account.type === "credit" ? -cents : cents;
}

export function plaidAccountTypeToCrest(
  type: string,
  subtype: string | null,
): AccountType {
  if (type === "credit") return "credit";
  if (subtype === "savings" || subtype === "cd" || subtype === "money market") {
    return "savings";
  }
  return "checking";
}

export function plaidTxnToUpsertInput(
  txn: Transaction,
  crestAccountId: string,
): UpsertTransactionInput {
  return {
    accountId: crestAccountId,
    amountCents: plaidAmountToCents(txn.amount),
    txnDate: txn.date,
    payee: txn.merchant_name ?? txn.name,
    memo: null,
    importedId: txn.transaction_id,
    clearedAt: txn.pending ? null : new Date().toISOString(),
    approvedAt: null,
  };
}
