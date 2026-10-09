-- Transfers must always have a transaction on both sides. Tighten
-- ledger_create_transfer: a re-run with an imported_id that finds only one
-- leg already present used to fall through and insert BOTH legs again,
-- duplicating the surviving leg. It now raises, and success is only reported
-- once both legs are confirmed to exist.

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

    -- Exactly one leg exists: a half-transfer left by an earlier bad write.
    -- Falling through would insert a second copy of the existing leg, so
    -- surface it instead of silently compounding the damage.
    IF v_outflow_id IS NOT NULL OR v_inflow_id IS NOT NULL THEN
      RAISE EXCEPTION
        'transfer % is half-present (outflow leg: %, inflow leg: %); delete the orphaned leg and retry',
        p_imported_id,
        COALESCE(v_outflow_id::text, 'missing'),
        COALESCE(v_inflow_id::text, 'missing');
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

  -- Both legs must exist as a mirrored pair before we report success. The
  -- inserts above are in one statement-level transaction, so this should be
  -- unreachable; it guards against a trigger or policy dropping a row.
  IF (SELECT count(*) FROM transactions
      WHERE id IN (v_outflow_id, v_inflow_id)) <> 2 THEN
    RAISE EXCEPTION 'transfer must have a transaction on both accounts';
  END IF;

  RETURN QUERY SELECT v_outflow_id, v_inflow_id, true;
END;
$$;
