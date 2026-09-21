-- Make ledger_link_transfer (20260917120000_link_transfer.sql) aware of
-- tracking (off-budget) accounts, mirroring the on_budget-aware approval
-- logic 20260917120100_tracking_accounts.sql added to ledger_create_transfer:
-- once either leg is a tracking account and the other is on-budget, cash is
-- crossing the budget boundary — economically like a purchase or income —
-- so the on-budget leg needs a category and is left pending instead of
-- auto-approved, reusing the normal pending-approval flow. Both-on-budget
-- and both-tracking pairs are unaffected: every leg still auto-approves.
--
-- A leg that already carried an approval before being linked keeps it
-- (COALESCE(approved_at, ...)), same as before this migration — linking
-- never un-approves an existing decision, it only decides the fallback for
-- a leg that was still pending.

CREATE OR REPLACE FUNCTION ledger_link_transfer(
  p_transaction_id uuid,
  p_counterpart_transaction_id uuid,
  p_amount_cents bigint,
  p_txn_date date,
  p_memo text,
  p_cleared_at timestamptz
)
RETURNS TABLE (outflow_transaction_id uuid, inflow_transaction_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  v_a transactions%ROWTYPE;
  v_b transactions%ROWTYPE;
  v_now timestamptz := now();
  v_a_on_budget boolean;
  v_b_on_budget boolean;
  v_a_fallback_approved_at timestamptz;
  v_b_fallback_approved_at timestamptz;
BEGIN
  IF p_transaction_id = p_counterpart_transaction_id THEN
    RAISE EXCEPTION 'cannot link a transaction to itself';
  END IF;

  IF p_amount_cents = 0 THEN
    RAISE EXCEPTION 'transfer amount must not be zero';
  END IF;

  SELECT * INTO v_a FROM transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction not found: %', p_transaction_id;
  END IF;

  SELECT * INTO v_b FROM transactions WHERE id = p_counterpart_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'counterpart transaction not found: %', p_counterpart_transaction_id;
  END IF;

  IF v_a.account_id = v_b.account_id THEN
    RAISE EXCEPTION 'transfer accounts must differ';
  END IF;

  IF v_a.transfer_account_id IS NOT NULL OR v_b.transfer_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'transaction is already part of a transfer';
  END IF;

  IF p_amount_cents <> -v_b.amount_cents THEN
    RAISE EXCEPTION 'transfer legs must have equal and opposite amounts (got % and %)',
      p_amount_cents, v_b.amount_cents;
  END IF;

  SELECT on_budget INTO v_a_on_budget FROM accounts WHERE id = v_a.account_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account not found or inactive: %', v_a.account_id;
  END IF;

  SELECT on_budget INTO v_b_on_budget FROM accounts WHERE id = v_b.account_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account not found or inactive: %', v_b.account_id;
  END IF;

  -- Fallback for a leg that's still pending going into the link: pending
  -- only for the on-budget side of a mixed (on-budget <-> tracking) pair,
  -- approved immediately otherwise (both on-budget, both tracking, or this
  -- leg itself is the tracking side).
  v_a_fallback_approved_at := CASE WHEN v_a_on_budget AND NOT v_b_on_budget THEN NULL ELSE v_now END;
  v_b_fallback_approved_at := CASE WHEN v_b_on_budget AND NOT v_a_on_budget THEN NULL ELSE v_now END;

  -- A transfer carries no allocations — its budget effect is derived from
  -- the transfer itself. Drop any categorization either leg had picked up
  -- before the user realized it was a transfer. (The on-budget leg of a
  -- mixed pair regains one the normal way, via the pending-approval flow.)
  DELETE FROM transaction_allocations WHERE transaction_id IN (v_a.id, v_b.id);

  UPDATE transactions
  SET amount_cents = p_amount_cents,
      txn_date = p_txn_date,
      memo = p_memo,
      cleared_at = p_cleared_at,
      transfer_account_id = v_b.account_id,
      approved_at = COALESCE(approved_at, v_a_fallback_approved_at)
  WHERE id = v_a.id;

  UPDATE transactions
  SET transfer_account_id = v_a.account_id,
      approved_at = COALESCE(approved_at, v_b_fallback_approved_at)
  WHERE id = v_b.id;

  IF p_amount_cents < 0 THEN
    RETURN QUERY SELECT v_a.id, v_b.id;
  ELSE
    RETURN QUERY SELECT v_b.id, v_a.id;
  END IF;
END;
$$;
