/**
 * Fuzzy matching for the YNAB → Plaid migration overlap.
 *
 * When a YNAB-imported Crest account is attached to a Plaid account, Plaid's
 * first history pull (`days_requested`, up to ~90 days) re-reports transactions
 * that were already imported from the YNAB CSV. The two sources use disjoint
 * `imported_id` namespaces (`csv:<hash>` vs Plaid's `transaction_id`), so the
 * normal `(account_id, imported_id)` dedupe never catches the overlap and every
 * shared transaction would appear twice.
 *
 * To avoid that, before inserting an incoming Plaid transaction we look for an
 * existing ("adoptable") row in the same account with the same amount and a
 * nearby date — a manual entry, a YNAB CSV import, or one leg of a transfer
 * such as a credit card payment — and adopt it: rewrite its `imported_id` to
 * Plaid's so future syncs dedupe normally, while preserving the user's
 * categorization (or transfer linkage). See `loadAdoptionCandidates` in
 * sync.ts for exactly which rows are eligible.
 *
 * This module is the pure selection logic; the DB-backed adoption lives in
 * `sync.ts`. See docs/plaid-integration-plan.md.
 */

/** How many days apart a YNAB txn date and a Plaid txn date may be and still match. */
export const MATCH_WINDOW_DAYS = 4;

/** An existing YNAB-imported transaction that a Plaid txn may be matched to. */
export type AdoptionCandidate = {
  id: string;
  amountCents: number;
  /** Calendar date, `YYYY-MM-DD`. */
  txnDate: string;
};

export type PlaidMatchInput = {
  amountCents: number;
  /** Calendar date, `YYYY-MM-DD`. */
  txnDate: string;
};

/** Whole-day difference between two `YYYY-MM-DD` dates (parsed as UTC midnight). */
function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Pick the best candidate for a Plaid transaction, or return -1 if none matches.
 *
 * A candidate qualifies only when its amount is exactly equal (integer cents,
 * already in Crest's sign convention) and its date is within `windowDays`.
 * Among qualifiers the closest date wins; ties break to the earliest date and
 * then to the lowest index, so selection is deterministic.
 *
 * The caller is responsible for removing the chosen candidate from the list so
 * a single YNAB row is never adopted by two Plaid transactions in one run.
 */
export function selectAdoptionMatch(
  plaid: PlaidMatchInput,
  candidates: AdoptionCandidate[],
  windowDays: number = MATCH_WINDOW_DAYS,
): number {
  let bestIdx = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  let bestDate = "";

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.amountCents !== plaid.amountCents) continue;

    const diff = Math.abs(dayDiff(c.txnDate, plaid.txnDate));
    if (diff > windowDays) continue;

    if (diff < bestDiff || (diff === bestDiff && c.txnDate < bestDate)) {
      bestIdx = i;
      bestDiff = diff;
      bestDate = c.txnDate;
    }
  }

  return bestIdx;
}
