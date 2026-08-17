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
  /** Stable ordinal within the source file, used to derive the imported_id hash. */
  rowIndex: number;
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
  rowIndex: number;
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
