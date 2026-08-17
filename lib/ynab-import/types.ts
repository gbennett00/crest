export type ParsedAllocation = {
  categoryGroup: string;
  category: string;
  amountCents: number;
};

export type ParsedTransaction = {
  account: string;
  date: string;
  payee: string;
  memo: string;
  amountCents: number;
  cleared: boolean;
  /** Empty means uncategorized in YNAB — lands as a pending (unapproved) import. */
  allocations: ParsedAllocation[];
  /**
   * Occurrence index among transactions sharing the same
   * account/date/payee/amount (memo is deliberately excluded, so editing a
   * memo and re-exporting updates the existing row rather than creating a
   * duplicate), used (with those fields) to derive the imported_id hash.
   * Unlike a raw CSV row index, this stays stable when a later export
   * inserts unrelated rows elsewhere in the file — it only shifts if a
   * genuinely new duplicate of the exact same transaction is inserted ahead
   * of it.
   */
  dedupeIndex: number;
};

export type ParsedOpeningBalance = {
  account: string;
  date: string;
  amountCents: number;
  /** false = YNAB Tracking (off-budget) account signal — its Starting Balance has no category. */
  onBudget: boolean;
};

export type ParsedTransfer = {
  fromAccount: string;
  toAccount: string;
  date: string;
  /** Positive magnitude. */
  amountCents: number;
  cleared: boolean;
  /** Occurrence index among transfers sharing the same accounts/date/amount — see ParsedTransaction.dedupeIndex. */
  dedupeIndex: number;
};

export type RegisterParseResult = {
  transactions: ParsedTransaction[];
  openingBalances: ParsedOpeningBalance[];
  transfers: ParsedTransfer[];
  /** Accounts whose Starting Balance row has no category — likely YNAB Tracking accounts. */
  offBudgetAccounts: string[];
  /** Rows dated after the cutoff (default: today) — YNAB scheduled/future transactions, excluded from import. */
  futureRowsSkipped: number;
  warnings: string[];
};

export type ParsedAssignment = {
  /** First-of-month, YYYY-MM-01. */
  month: string;
  categoryGroup: string;
  category: string;
  /** True for "Credit Card Payments" group rows — resolved to the account's payment category, not a created category. */
  isCreditCardPayment: boolean;
  assignedCents: number;
};

export type PlanParseResult = {
  assignments: ParsedAssignment[];
  warnings: string[];
};
