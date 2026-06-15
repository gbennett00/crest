/** Integer cents — never use floats for money. */
export type Cents = number;

export type AccountType = "checking" | "savings" | "credit";

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
  allocations?: TransactionAllocationInput[];
};

export type CreateAccountInput = {
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
};

export type TransactionAmountLine = {
  amountCents: Cents;
  clearedAt: string | null;
};

export type ReconciliationCheckInput = {
  /** Last bank-reported cleared balance (accounts.balance_cents, Plaid current). */
  bankClearedBalanceCents: Cents;
  /** All register lines; reconcile uses cleared only (incl. opening-balance txn). */
  transactions: TransactionAmountLine[];
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
