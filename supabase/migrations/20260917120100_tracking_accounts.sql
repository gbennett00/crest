-- Tracking (off-budget) accounts — see docs/budgeting-app-architecture.md
-- § ACCOUNTS and § TRANSFERS. An account's on_budget-ness is derived from its
-- type (never set directly), so it can never drift out of sync with type the
-- way a free-standing boolean could.
--
-- Tracking-account transactions still flow through the full ledger — full
-- history, cleared/reconciled state, everything account_balances and
-- account_monthly_balance (and therefore net worth) rely on — they are just
-- exempt from budget categorization: they never carry allocations and are
-- always created already-approved (enforced in application code; the DB only
-- relaxes the allocation-required rule so that state is legal).

ALTER TABLE accounts
  ADD COLUMN on_budget boolean
  GENERATED ALWAYS AS (type NOT IN ('asset', 'liability')) STORED;

COMMENT ON COLUMN accounts.on_budget IS
  'Derived from type — never set directly. Off-budget (tracking) accounts (asset, liability) feed net worth but never the budget: see enforce_approved_transaction_has_allocations and ledger_create_transfer.';

-- ---------------------------------------------------------------------------
-- Allocation-required triggers: also exempt off-budget accounts, alongside
-- the existing transfer exemption (transfers.transfer_account_id IS NOT NULL).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_approved_transaction_has_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_on_budget boolean;
BEGIN
  IF NEW.approved_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Transfers carry no allocations; their budget effect is derived elsewhere.
  IF NEW.transfer_account_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Tracking accounts are never categorized.
  SELECT on_budget INTO v_on_budget FROM accounts WHERE id = NEW.account_id;
  IF v_on_budget IS FALSE THEN
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

CREATE OR REPLACE FUNCTION enforce_transaction_splits_sum()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_txn_id uuid;
  v_txn_amount bigint;
  v_split_sum bigint;
  v_approved_at timestamptz;
  v_transfer_account_id uuid;
  v_on_budget boolean;
BEGIN
  v_txn_id := COALESCE(NEW.transaction_id, OLD.transaction_id);

  SELECT t.amount_cents, t.approved_at, t.transfer_account_id, a.on_budget
  INTO v_txn_amount, v_approved_at, v_transfer_account_id, v_on_budget
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  WHERE t.id = v_txn_id;

  -- Pending imports may have no splits or incomplete splits until approval.
  IF v_approved_at IS NULL THEN
    RETURN NULL;
  END IF;

  -- Transfers carry no allocations; nothing to reconcile to the amount. This
  -- also lets allocations be removed from a (previously miscategorized) transfer.
  IF v_transfer_account_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- Tracking accounts are never categorized.
  IF v_on_budget IS FALSE THEN
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

CREATE OR REPLACE FUNCTION enforce_transaction_splits_sum_on_txn_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_split_sum bigint;
  v_on_budget boolean;
BEGIN
  IF NEW.approved_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Transfers carry no allocations; there is nothing to reconcile to the amount.
  IF NEW.transfer_account_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Tracking accounts are never categorized.
  SELECT on_budget INTO v_on_budget FROM accounts WHERE id = NEW.account_id;
  IF v_on_budget IS FALSE THEN
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

-- ---------------------------------------------------------------------------
-- ledger_create_transfer: on-budget <-> on-budget is unchanged (both legs
-- pre-approved, no allocation — a transfer between budgeted cash pools has
-- zero budget effect). Once either side is a tracking account, the leg on
-- the *on-budget* account is left pending approval instead of exempted: cash
-- crossing the budget boundary is economically like a purchase or income and
-- needs a category, reusing the existing "categorize then approve" flow
-- (home page pending-approval list) rather than any new UI. The leg on the
-- tracking-account side is always auto-approved with no allocation, same as
-- before — tracking accounts are never categorized.
-- ---------------------------------------------------------------------------

-- 20260816170000_idempotent_transfers.sql added p_imported_id via CREATE OR
-- REPLACE, but a new parameter changes the signature, so Postgres created a
-- second overload instead of replacing the original — the pre-imported_id,
-- 7-arg version has been dead (no caller passes fewer than 8 args) but still
-- present ever since, and ambiguous against a positional call. Drop it now
-- that this migration touches the same function anyway.
DROP FUNCTION IF EXISTS ledger_create_transfer(uuid, uuid, bigint, date, text, text, timestamptz);

CREATE OR REPLACE FUNCTION ledger_create_transfer(
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount_cents bigint,
  p_txn_date date,
  p_payee text DEFAULT 'Transfer',
  p_memo text DEFAULT NULL,
  p_cleared_at timestamptz DEFAULT NULL,
  p_imported_id text DEFAULT NULL
)
RETURNS TABLE (outflow_transaction_id uuid, inflow_transaction_id uuid, created boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_outflow_id uuid;
  v_inflow_id uuid;
  v_now timestamptz := now();
  v_from_on_budget boolean;
  v_to_on_budget boolean;
  v_outflow_approved_at timestamptz;
  v_inflow_approved_at timestamptz;
BEGIN
  IF p_from_account_id = p_to_account_id THEN
    RAISE EXCEPTION 'transfer accounts must differ';
  END IF;

  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'transfer amount must be positive (got %)', p_amount_cents;
  END IF;

  SELECT on_budget INTO v_from_on_budget FROM accounts WHERE id = p_from_account_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'from account not found or inactive';
  END IF;

  SELECT on_budget INTO v_to_on_budget FROM accounts WHERE id = p_to_account_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'to account not found or inactive';
  END IF;

  -- Pending only for the on-budget leg of a mixed (on-budget <-> tracking)
  -- transfer; approved immediately in every other case (both on-budget, both
  -- tracking, or this leg itself is the tracking side).
  v_outflow_approved_at := CASE WHEN v_from_on_budget AND NOT v_to_on_budget THEN NULL ELSE v_now END;
  v_inflow_approved_at := CASE WHEN v_to_on_budget AND NOT v_from_on_budget THEN NULL ELSE v_now END;

  IF p_imported_id IS NOT NULL THEN
    SELECT id INTO v_outflow_id
    FROM transactions
    WHERE account_id = p_from_account_id AND imported_id = p_imported_id;

    SELECT id INTO v_inflow_id
    FROM transactions
    WHERE account_id = p_to_account_id AND imported_id = p_imported_id;

    IF v_outflow_id IS NOT NULL AND v_inflow_id IS NOT NULL THEN
      RETURN QUERY SELECT v_outflow_id, v_inflow_id, false;
      RETURN;
    END IF;
  END IF;

  INSERT INTO transactions (
    account_id,
    amount_cents,
    txn_date,
    payee,
    memo,
    transfer_account_id,
    cleared_at,
    approved_at,
    imported_id
  )
  VALUES (
    p_from_account_id,
    -p_amount_cents,
    p_txn_date,
    p_payee,
    p_memo,
    p_to_account_id,
    p_cleared_at,
    v_outflow_approved_at,
    p_imported_id
  )
  RETURNING id INTO v_outflow_id;

  INSERT INTO transactions (
    account_id,
    amount_cents,
    txn_date,
    payee,
    memo,
    transfer_account_id,
    cleared_at,
    approved_at,
    imported_id
  )
  VALUES (
    p_to_account_id,
    p_amount_cents,
    p_txn_date,
    p_payee,
    p_memo,
    p_from_account_id,
    p_cleared_at,
    v_inflow_approved_at,
    p_imported_id
  )
  RETURNING id INTO v_inflow_id;

  RETURN QUERY SELECT v_outflow_id, v_inflow_id, true;
END;
$$;
