-- Crest initial schema (see docs/budgeting-app-architecture.md)
-- Money: bigint cents. Budget months: DATE (first day of month).
-- Derived budget state (available, activity, ready-to-assign) is NOT stored.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE account_type AS ENUM ('checking', 'savings', 'credit');

CREATE TYPE budget_mode AS ENUM ('category', 'group');

CREATE TYPE target_type AS ENUM ('fill_up_to', 'set_aside', 'by_date');

CREATE TYPE category_role AS ENUM ('ready_to_assign');

-- ---------------------------------------------------------------------------
-- Category groups & categories (before accounts — payment categories)
-- ---------------------------------------------------------------------------

CREATE TABLE category_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  budget_mode budget_mode NOT NULL DEFAULT 'category',
  is_pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  group_id uuid NOT NULL REFERENCES category_groups (id) ON DELETE RESTRICT,
  role category_role,
  is_pinned boolean NOT NULL DEFAULT false,
  is_hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX categories_role_ready_to_assign_unique
  ON categories (role)
  WHERE role = 'ready_to_assign';

CREATE INDEX categories_group_id_idx ON categories (group_id);

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type account_type NOT NULL,
  balance_cents bigint NOT NULL DEFAULT 0,
  payment_category_id uuid REFERENCES categories (id) ON DELETE RESTRICT,
  is_linked boolean NOT NULL DEFAULT false,
  plaid_item_id text,
  plaid_account_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_credit_requires_payment_category CHECK (
    type <> 'credit' OR payment_category_id IS NOT NULL
  ),
  CONSTRAINT accounts_non_credit_no_payment_category CHECK (
    type = 'credit' OR payment_category_id IS NULL
  )
);

COMMENT ON COLUMN accounts.balance_cents IS
  'Last bank-reported cleared/posted balance (Plaid accounts.balance.current on sync). Reconcile against sum(cleared transactions); opening balance is a cleared txn (imported_id crest:opening_balance).';

CREATE INDEX accounts_payment_category_id_idx ON accounts (payment_category_id);

-- ---------------------------------------------------------------------------
-- Ledger: transactions & splits
-- ---------------------------------------------------------------------------

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL,
  txn_date date NOT NULL,
  payee text NOT NULL DEFAULT '',
  memo text,
  transfer_account_id uuid REFERENCES accounts (id) ON DELETE RESTRICT,
  imported_id text,
  approved_at timestamptz,
  cleared_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactions_transfer_not_self CHECK (
    transfer_account_id IS NULL OR transfer_account_id <> account_id
  )
);

CREATE INDEX transactions_account_id_idx ON transactions (account_id);
CREATE INDEX transactions_txn_date_idx ON transactions (txn_date);
CREATE UNIQUE INDEX transactions_account_imported_id_unique
  ON transactions (account_id, imported_id)
  WHERE imported_id IS NOT NULL;

CREATE TABLE transaction_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL,
  CONSTRAINT transaction_allocations_amount_nonzero CHECK (amount_cents <> 0)
);

CREATE INDEX transaction_allocations_transaction_id_idx
  ON transaction_allocations (transaction_id);
CREATE INDEX transaction_allocations_category_id_idx
  ON transaction_allocations (category_id);

-- ---------------------------------------------------------------------------
-- Budget: monthly assignments, targets, settings
-- ---------------------------------------------------------------------------

CREATE TABLE monthly_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month date NOT NULL,
  category_id uuid REFERENCES categories (id) ON DELETE CASCADE,
  group_id uuid REFERENCES category_groups (id) ON DELETE CASCADE,
  assigned_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monthly_budgets_month_first_day CHECK (
    month = date_trunc('month', month)::date
  ),
  CONSTRAINT monthly_budgets_category_xor_group CHECK (
    (category_id IS NULL) <> (group_id IS NULL)
  )
);

CREATE UNIQUE INDEX monthly_budgets_month_category_unique
  ON monthly_budgets (month, category_id)
  WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX monthly_budgets_month_group_unique
  ON monthly_budgets (month, group_id)
  WHERE group_id IS NOT NULL;

CREATE TABLE targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES categories (id) ON DELETE CASCADE,
  group_id uuid REFERENCES category_groups (id) ON DELETE CASCADE,
  type target_type NOT NULL,
  amount_cents bigint NOT NULL,
  target_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT targets_category_xor_group CHECK (
    (category_id IS NULL) <> (group_id IS NULL)
  ),
  CONSTRAINT targets_by_date_requires_target_date CHECK (
    type <> 'by_date' OR target_date IS NOT NULL
  )
);

CREATE TABLE budget_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monthly_income_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Seed: Ready to Assign (system budget pool — see docs READY TO ASSIGN)
-- ---------------------------------------------------------------------------

INSERT INTO category_groups (name, budget_mode, is_pinned)
VALUES ('Budget', 'category', true);

INSERT INTO categories (name, group_id, is_pinned, role)
SELECT 'Ready to Assign', id, true, 'ready_to_assign'::category_role
FROM category_groups
WHERE name = 'Budget';

-- ---------------------------------------------------------------------------
-- Integrity triggers (split enforcement — see implementation priority #3)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_transaction_splits_sum()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_txn_id uuid;
  v_txn_amount bigint;
  v_split_sum bigint;
  v_approved_at timestamptz;
BEGIN
  v_txn_id := COALESCE(NEW.transaction_id, OLD.transaction_id);

  SELECT amount_cents, approved_at
  INTO v_txn_amount, v_approved_at
  FROM transactions
  WHERE id = v_txn_id;

  -- Pending imports may have no splits or incomplete splits until approval.
  IF v_approved_at IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_split_sum
  FROM transaction_allocations
  WHERE transaction_id = v_txn_id;

  IF v_split_sum IS DISTINCT FROM v_txn_amount THEN
    RAISE EXCEPTION
      'transaction_allocations must sum to transaction amount (splits: %, txn: %)',
      v_split_sum,
      v_txn_amount;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transaction_allocations_sum_matches_txn
  AFTER INSERT OR UPDATE OR DELETE ON transaction_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION enforce_transaction_splits_sum();

CREATE OR REPLACE FUNCTION enforce_approved_transaction_has_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.approved_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM transaction_allocations
    WHERE transaction_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'approved transactions must have at least one allocation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER transactions_approved_require_allocations
  AFTER INSERT OR UPDATE OF approved_at ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.approved_at IS NOT NULL)
  EXECUTE FUNCTION enforce_approved_transaction_has_allocations();

CREATE OR REPLACE FUNCTION enforce_transaction_splits_sum_on_txn_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_split_sum bigint;
BEGIN
  IF NEW.approved_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
  THEN
    SELECT COALESCE(SUM(amount_cents), 0) INTO v_split_sum
    FROM transaction_allocations
    WHERE transaction_id = NEW.id;

    IF v_split_sum IS DISTINCT FROM NEW.amount_cents THEN
      RAISE EXCEPTION
        'transaction_allocations must sum to transaction amount (splits: %, txn: %)',
        v_split_sum,
        NEW.amount_cents;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_amount_or_approval_recheck_splits
  AFTER UPDATE OF amount_cents, approved_at ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_transaction_splits_sum_on_txn_update();

-- ---------------------------------------------------------------------------
-- Ledger: atomic transfer (see lib/ledger/operations.ts createTransfer)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ledger_create_transfer(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount_cents bigint,
  p_txn_date date,
  p_payee text DEFAULT 'Transfer',
  p_memo text DEFAULT NULL,
  p_cleared_at timestamptz DEFAULT NULL
)
RETURNS TABLE (outflow_transaction_id uuid, inflow_transaction_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  v_outflow_id uuid;
  v_inflow_id uuid;
BEGIN
  IF p_from_account_id = p_to_account_id THEN
    RAISE EXCEPTION 'transfer accounts must differ';
  END IF;

  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'transfer amount must be positive (got %)', p_amount_cents;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_from_account_id AND is_active) THEN
    RAISE EXCEPTION 'from account not found or inactive';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_to_account_id AND is_active) THEN
    RAISE EXCEPTION 'to account not found or inactive';
  END IF;

  INSERT INTO transactions (
    account_id,
    amount_cents,
    txn_date,
    payee,
    memo,
    transfer_account_id,
    cleared_at
  )
  VALUES (
    p_from_account_id,
    -p_amount_cents,
    p_txn_date,
    p_payee,
    p_memo,
    p_to_account_id,
    p_cleared_at
  )
  RETURNING id INTO v_outflow_id;

  INSERT INTO transactions (
    account_id,
    amount_cents,
    txn_date,
    payee,
    memo,
    transfer_account_id,
    cleared_at
  )
  VALUES (
    p_to_account_id,
    p_amount_cents,
    p_txn_date,
    p_payee,
    p_memo,
    p_from_account_id,
    p_cleared_at
  )
  RETURNING id INTO v_inflow_id;

  RETURN QUERY SELECT v_outflow_id, v_inflow_id;
END;
$$;
