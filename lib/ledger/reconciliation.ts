import { sumClearedTransactionAmounts } from "./balance";
import type {
  ReconciliationCheckInput,
  ReconciliationCheckResult,
} from "./types";

/**
 * Reconcile bank cleared balance (balance_cents) to sum of cleared register lines.
 * Opening balance must be a cleared transaction (see createOpeningBalance).
 */
export function checkReconciliation(
  input: ReconciliationCheckInput,
): ReconciliationCheckResult {
  const registerCleared = sumClearedTransactionAmounts(input.transactions);

  if (registerCleared === input.bankClearedBalanceCents) {
    return { ok: true };
  }

  return {
    ok: false,
    differenceCents: input.bankClearedBalanceCents - registerCleared,
    registerClearedBalanceCents: registerCleared,
    bankClearedBalanceCents: input.bankClearedBalanceCents,
  };
}

export const RECONCILIATION_FIX_HINT =
  "Your cleared register does not match the last cleared balance from the bank. Check for missing or duplicate cleared transactions, or confirm in your bank app.";
