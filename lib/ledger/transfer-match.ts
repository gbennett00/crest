/**
 * Pure matching for "link as transfer": given a transaction being converted
 * into a transfer, find an existing unlinked transaction in the destination
 * account that is plausibly its other leg — most commonly a credit card
 * payment that Plaid already reported independently on both the checking
 * and card accounts. Linking to it instead of creating a new counterpart
 * avoids double-counting the payment (see ledger_link_transfer).
 */

/** How many days apart the two legs' dates may be and still match. */
export const TRANSFER_LINK_WINDOW_DAYS = 4;

/** An existing, unlinked transaction that may be adopted as a transfer's other leg. */
export type TransferLinkCandidate = {
  id: string;
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
 * Picks the best candidate to adopt as the other leg of a transfer, or -1 if
 * none qualifies. A candidate qualifies only when its amount is the exact
 * opposite of the transaction being converted and its date is within
 * `windowDays`. Among qualifiers the closest date wins, ties breaking to the
 * earliest date then the lowest index, so selection is deterministic.
 */
export function selectTransferLinkMatch(
  source: { amountCents: number; txnDate: string },
  candidates: TransferLinkCandidate[],
  windowDays: number = TRANSFER_LINK_WINDOW_DAYS,
): number {
  let bestIdx = -1;
  let bestDiff = Number.POSITIVE_INFINITY;
  let bestDate = "";

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.amountCents !== -source.amountCents) continue;

    const diff = Math.abs(dayDiff(c.txnDate, source.txnDate));
    if (diff > windowDays) continue;

    if (diff < bestDiff || (diff === bestDiff && c.txnDate < bestDate)) {
      bestIdx = i;
      bestDiff = diff;
      bestDate = c.txnDate;
    }
  }

  return bestIdx;
}
