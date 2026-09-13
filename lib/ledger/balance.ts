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
 * Whether an account is eligible to be closed, and why not if it isn't.
 *
 * Closing an account is only safe once its register is fully settled: every
 * transaction must be cleared (no uncleared/pending lines lingering) and the
 * working balance must be exactly zero (no money left to move out). This keeps
 * balance math and reconciliation honest — a closed account contributes nothing.
 *
 * Pure decision function: the two facts it needs (whether any uncleared line
 * remains, and the working balance) are aggregated in Postgres and passed in by
 * `loadAccountClosureState`, so this never walks the whole register itself.
 */
export function evaluateAccountClosure(input: {
  hasUnclearedTransactions: boolean;
  workingBalanceCents: Cents;
}): {
  eligible: boolean;
  allCleared: boolean;
  workingBalanceCents: Cents;
} {
  const allCleared = !input.hasUnclearedTransactions;
  return {
    eligible: allCleared && input.workingBalanceCents === 0,
    allCleared,
    workingBalanceCents: input.workingBalanceCents,
  };
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
