import type { Cents, TransactionAmountLine } from "./types";

/** Sum signed transaction amounts (negative = outflow, positive = inflow). */
export function sumTransactionAmounts(amounts: Cents[]): Cents {
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

/**
 * Working balance: sum of every register line (cleared + uncleared),
 * regardless of bank workflow state. This is the register's own truth and
 * updates the moment a transaction is entered — unlike `balance_cents`, which
 * only catches up on Plaid sync or reconciliation. Equals
 * `sumClearedTransactionAmounts` + `sumPendingTransactionAmounts`.
 */
export function workingBalanceCents(
  transactions: TransactionAmountLine[],
): Cents {
  return transactions.reduce((sum, t) => sum + t.amountCents, 0);
}

/** Sum of uncleared (pending) register lines: cleared_at IS NULL. */
export function sumPendingTransactionAmounts(
  transactions: TransactionAmountLine[],
): Cents {
  return transactions
    .filter((t) => t.clearedAt === null)
    .reduce((sum, t) => sum + t.amountCents, 0);
}

/** Sum of cleared register lines (includes opening-balance transaction when cleared). */
export function sumClearedTransactionAmounts(
  transactions: TransactionAmountLine[],
): Cents {
  return transactions
    .filter((t) => t.clearedAt !== null)
    .reduce((sum, t) => sum + t.amountCents, 0);
}

/**
 * Helpful approximate spendable balance: last bank cleared balance plus
 * pending (uncleared) activity in the Crest register.
 */
export function approximateAvailableCents(
  bankClearedBalanceCents: Cents,
  transactions: TransactionAmountLine[],
): Cents {
  return bankClearedBalanceCents + sumPendingTransactionAmounts(transactions);
}
