import { LedgerError } from "./errors";
import type { AccountType, Cents, TransactionAllocationInput } from "./types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function assertIntegerCents(value: Cents, field: string): void {
  if (!Number.isInteger(value)) {
    throw new LedgerError("invalid_cents", `${field} must be an integer number of cents`);
  }
}

export function assertNonZeroAmount(amountCents: Cents): void {
  assertIntegerCents(amountCents, "amountCents");
  if (amountCents === 0) {
    throw new LedgerError("invalid_amount", "amountCents cannot be zero");
  }
}

export function assertPositiveAmount(amountCents: Cents): void {
  assertIntegerCents(amountCents, "amountCents");
  if (amountCents <= 0) {
    throw new LedgerError("invalid_amount", "amountCents must be a positive magnitude");
  }
}

export function assertTxnDate(txnDate: string): void {
  if (!DATE_REGEX.test(txnDate)) {
    throw new LedgerError("invalid_date", "txnDate must be YYYY-MM-DD");
  }
}

export function sumAllocationCents(allocations: TransactionAllocationInput[]): Cents {
  return allocations.reduce((sum, row) => sum + row.amountCents, 0);
}

/**
 * Split totals must equal the transaction amount when splits are provided.
 * Approved transactions require splits that sum to the transaction amount.
 */
export function validateAllocations(
  amountCents: Cents,
  allocations: TransactionAllocationInput[] | undefined,
  approvedAt: string | null | undefined,
): void {
  assertIntegerCents(amountCents, "amountCents");

  if (!allocations || allocations.length === 0) {
    if (approvedAt) {
      throw new LedgerError("allocations_required", "approved transactions must have at least one allocation");
    }
    return;
  }

  for (const row of allocations) {
    assertIntegerCents(row.amountCents, "allocation.amountCents");
    if (row.amountCents === 0) {
      throw new LedgerError("invalid_allocation", "allocation amounts cannot be zero");
    }
  }

  const splitSum = sumAllocationCents(allocations);
  if (splitSum !== amountCents) {
    throw new LedgerError(
      "split_sum_mismatch",
      `allocations must sum to transaction amount (splits: ${splitSum}, txn: ${amountCents})`,
    );
  }
}

export function validateCreditAccount(type: AccountType, paymentCategoryId: string | null | undefined): void {
  if (type === "credit" && !paymentCategoryId) {
    throw new LedgerError("payment_category_required", "credit accounts require paymentCategoryId");
  }
  if (type !== "credit" && paymentCategoryId) {
    throw new LedgerError("payment_category_forbidden", "only credit accounts may have a payment category");
  }
}

export function validateTransferAccounts(fromAccountId: string, toAccountId: string): void {
  if (fromAccountId === toAccountId) {
    throw new LedgerError("invalid_transfer", "transfer accounts must differ");
  }
}
