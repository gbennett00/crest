-- Bulk importers (e.g. the YNAB CSV importer) need to safely re-run without
-- creating duplicate transfer pairs. Add an optional imported_id so a re-run
-- with the same id returns the existing pair instead of inserting a new one.
-- The parameter is additive with a default of NULL, so existing callers
-- (manual transfer creation) are unaffected.

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
    v_approved_at,
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
    v_approved_at,
    p_imported_id
  )
  RETURNING id INTO v_inflow_id;

  RETURN QUERY SELECT v_outflow_id, v_inflow_id, true;
END;
$$;
