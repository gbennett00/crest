import type {
  ReconciliationCheckInput,
  ReconciliationCheckResult,
} from "./types";

/**
 * Reconcile bank cleared balance (balance_cents) to the register cleared
 * balance. The cleared sum is computed in Postgres (the `account_balances`
 * view); the opening balance is a cleared transaction and so is included.
 */
export function checkReconciliation(
  input: ReconciliationCheckInput,
): ReconciliationCheckResult {
  const registerCleared = input.registerClearedBalanceCents;

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
