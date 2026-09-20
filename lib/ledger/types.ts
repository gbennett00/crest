/** Integer cents — never use floats for money. */
export type Cents = number;

export type AccountType = "checking" | "savings" | "credit" | "asset" | "liability";

/** Off-budget (tracking) types: feed net worth, never the budget. Derived
 * from `type` via the `accounts.on_budget` generated column — never set
 * directly. */
export const TRACKING_ACCOUNT_TYPES: readonly AccountType[] = ["asset", "liability"];

export type TransactionAllocationInput = {
  categoryId: string;
  amountCents: Cents;
};

export type UpsertTransactionInput = {
  accountId: string;
  amountCents: Cents;
  txnDate: string;
  payee?: string;
  memo?: string | null;
  importedId: string;
  transferAccountId?: string | null;
  clearedAt?: string | null;
  approvedAt?: string | null;
  allocations?: TransactionAllocationInput[];
  /**
   * Set only by trusted internal callers (createOpeningBalance) that have
   * already looked up the account's on_budget status, to skip the
   * allocation-required check for tracking accounts. Import/sync callers
   * (Plaid, CSV) never set this — tracking accounts are manual-only, so if
   * one somehow reached this path the deferred DB constraint is the backstop.
   */
  accountOnBudget?: boolean;
};

/**
 * Result of one row from bulkUpsertTransactions, keyed by its position in the
 * input array (not the DB id) so callers can map failures/successes back to
 * their own source data (e.g. a CSV row).
 */
export type BulkUpsertTransactionResult = {
  index: number;
  transactionId: string;
  created: boolean;
};

export type CreateTransactionInput = {
  accountId: string;
  amountCents: Cents;
  txnDate: string;
  payee?: string;
  memo?: string | null;
  transferAccountId?: string | null;
  clearedAt?: string | null;
  approvedAt?: string | null;
  allocations?: TransactionAllocationInput[];
  /**
   * Set by callers that already know the target account's on_budget status
   * (e.g. saveTransaction), to skip the allocation-required check for
   * tracking accounts. Defaults to true (on-budget) when omitted, so any
   * caller that doesn't know better keeps today's strict behavior — the
   * deferred DB constraint is the backstop if that default is ever wrong.
   */
  accountOnBudget?: boolean;
};

export type UpdateTransactionInput = {
  id: string;
  accountId?: string;
  amountCents?: Cents;
  txnDate?: string;
  payee?: string;
  memo?: string | null;
  transferAccountId?: string | null;
  clearedAt?: string | null;
  approvedAt?: string | null;
  /** See CreateTransactionInput.accountOnBudget. */
  accountOnBudget?: boolean;
  allocations?: TransactionAllocationInput[];
};

export type CreateAccountInput = {
  /** Plan that owns the account (required — accounts.plan_id is NOT NULL). */
  planId: string;
  name: string;
  type: AccountType;
  /** Creates opening-balance txn + seeds balance_cents for manual/test accounts. */
  openingBalanceCents?: Cents;
  paymentCategoryId?: string | null;
  isLinked?: boolean;
};

export type CreateOpeningBalanceInput = {
  accountId: string;
  amountCents: Cents;
  txnDate?: string;
};

export type CreateTransferInput = {
  fromAccountId: string;
  toAccountId: string;
  amountCents: Cents;
  txnDate: string;
  payee?: string;
  memo?: string | null;
  clearedAt?: string | null;
  /** Dedupe key for re-runnable imports: replays with the same id return the existing pair. */
  importedId?: string | null;
};

export type TransactionAmountLine = {
  amountCents: Cents;
  clearedAt: string | null;
};

export type ReconciliationCheckInput = {
  /** Last bank-reported cleared balance (accounts.balance_cents, Plaid current). */
  bankClearedBalanceCents: Cents;
  /** Register cleared balance (sum of cleared lines, incl. opening-balance txn). */
  registerClearedBalanceCents: Cents;
};

/**
 * Per-account balance sums, aggregated in Postgres by the `account_balances`
 * view. Mirrors sumCleared / sumPending / workingBalanceCents in ./balance.
 */
export type AccountBalance = {
  clearedCents: Cents;
  unclearedCents: Cents;
  workingCents: Cents;
};

export type ReconciliationCheckResult =
  | { ok: true }
  | {
      ok: false;
      differenceCents: Cents;
      registerClearedBalanceCents: Cents;
      bankClearedBalanceCents: Cents;
    };

export type AccountBalanceSummary = {
  bankClearedBalanceCents: Cents;
  registerClearedBalanceCents: Cents;
  pendingActivityCents: Cents;
  approximateAvailableCents: Cents;
};

export type TransactionRow = {
  id: string;
  account_id: string;
  amount_cents: number;
  txn_date: string;
  payee: string;
  memo: string | null;
  transfer_account_id: string | null;
  imported_id: string | null;
  approved_at: string | null;
  cleared_at: string | null;
  reconciled_at: string | null;
  created_at: string;
};

export type AllocationRow = {
  id: string;
  transaction_id: string;
  category_id: string;
  amount_cents: number;
};

export type UpsertCategoryBudgetInput = {
  categoryId: string;
  /** First day of the month: YYYY-MM-01 */
  month: string;
  assignedCents: Cents;
};

export type UpsertGroupBudgetInput = {
  groupId: string;
  /** First day of the month: YYYY-MM-01 */
  month: string;
  assignedCents: Cents;
};
