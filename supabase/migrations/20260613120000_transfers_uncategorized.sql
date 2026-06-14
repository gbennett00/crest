-- Transfers are account-to-account movements and carry no budget category.
-- Their budget effect (e.g. draining a credit-card payment category on a card
-- payment) is derived from the transfer itself in the budget read-models, not
-- from allocations. So:
--   1. Exempt transfers from the "approved transaction must have an allocation"
--      rule and the split-sum recheck (a transfer legitimately has zero splits).
--   2. Create both legs already-approved so they don't linger in the approval
--      queue waiting for a category that should never be assigned.

CREATE OR REPLACE FUNCTION enforce_approved_transaction_has_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.approved_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Transfers carry no allocations; their budget effect is derived elsewhere.
  IF NEW.transfer_account_id IS NOT NULL THEN
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
BEGIN
  v_txn_id := COALESCE(NEW.transaction_id, OLD.transaction_id);

  SELECT amount_cents, approved_at, transfer_account_id
  INTO v_txn_amount, v_approved_at, v_transfer_account_id
  FROM transactions
  WHERE id = v_txn_id;

  -- Pending imports may have no splits or incomplete splits until approval.
  IF v_approved_at IS NULL THEN
    RETURN NULL;
  END IF;

  -- Transfers carry no allocations; nothing to reconcile to the amount. This
  -- also lets allocations be removed from a (previously miscategorized) transfer.
  IF v_transfer_account_id IS NOT NULL THEN
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
BEGIN
  IF NEW.approved_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Transfers carry no allocations; there is nothing to reconcile to the amount.
  IF NEW.transfer_account_id IS NOT NULL THEN
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

-- Recreate the transfer RPC so both legs are created already approved. Same
-- signature as before, so existing GRANTs are preserved.
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
  v_approved_at timestamptz := now();
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
    cleared_at,
    approved_at
  )
  VALUES (
    p_from_account_id,
    -p_amount_cents,
    p_txn_date,
    p_payee,
    p_memo,
    p_to_account_id,
    p_cleared_at,
    v_approved_at
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
    approved_at
  )
  VALUES (
    p_to_account_id,
    p_amount_cents,
    p_txn_date,
    p_payee,
    p_memo,
    p_from_account_id,
    p_cleared_at,
    v_approved_at
  )
  RETURNING id INTO v_inflow_id;

  RETURN QUERY SELECT v_outflow_id, v_inflow_id;
END;
$$;
