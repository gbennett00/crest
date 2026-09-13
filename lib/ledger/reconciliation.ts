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

/** Which reconcile entry point the UI should open with. */
export type ReconcileView = "matched" | "review" | "manual";

/**
 * Decide the reconcile starting view. A linked account carries an authoritative
 * bank-reported cleared balance (`balance_cents`), so we can tell the user up
 * front whether their cleared register already agrees — "matched" when it does,
 * "review" when it doesn't. Everything else falls back to "manual", where the
 * user confirms the cleared total against their own bank app.
 *
 * The comparison is against the *cleared* register only; pending/uncleared
 * transactions never move `registerClearedBalanceCents` and so never affect the
 * match (see `sumClearedTransactionAmounts`).
 */
export function reconcileInitialView(
  isLinked: boolean,
  bankBalanceCents: number | null,
  registerClearedBalanceCents: number,
): ReconcileView {
  if (!isLinked || bankBalanceCents === null) return "manual";
  return bankBalanceCents === registerClearedBalanceCents ? "matched" : "review";
}
