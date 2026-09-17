-- Linking two existing transactions into a transfer, instead of always
-- creating both legs from scratch (ledger_create_transfer). This is for the
-- case where Plaid has already independently synced both sides of a transfer
-- — most commonly a credit card payment, reported as an ordinary outflow on
-- the checking account and an ordinary inflow on the card — and the user
-- marks one of them as a transfer. Recreating both legs would leave the
-- other side's Plaid-synced row in place as an unlinked duplicate, double
-- counting the payment; linking the two existing rows together instead
-- avoids that.
--
-- p_transaction_id is the row being converted (its edited amount/date/memo/
-- cleared_at from the form are applied here too, atomically with the link,
-- so a same-transaction amount edit and the transfer conversion can never
-- commit in an inconsistent intermediate state). p_counterpart_transaction_id
-- is the existing row being adopted as its other leg, untouched apart from
-- gaining the transfer linkage.
--
-- See lib/ledger/operations.ts (linkTransferPair) and
-- app/(app)/transactions/actions.ts (saveTransaction) for the caller.

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

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = v_a.account_id AND is_active) THEN
    RAISE EXCEPTION 'account not found or inactive: %', v_a.account_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = v_b.account_id AND is_active) THEN
    RAISE EXCEPTION 'account not found or inactive: %', v_b.account_id;
  END IF;

  -- A transfer carries no allocations — its budget effect is derived from
  -- the transfer itself. Drop any categorization either leg had picked up
  -- before the user realized it was a transfer.
  DELETE FROM transaction_allocations WHERE transaction_id IN (v_a.id, v_b.id);

  UPDATE transactions
  SET amount_cents = p_amount_cents,
      txn_date = p_txn_date,
      memo = p_memo,
      cleared_at = p_cleared_at,
      transfer_account_id = v_b.account_id,
      approved_at = COALESCE(approved_at, v_now)
  WHERE id = v_a.id;

  UPDATE transactions
  SET transfer_account_id = v_a.account_id,
      approved_at = COALESCE(approved_at, v_now)
  WHERE id = v_b.id;

  IF p_amount_cents < 0 THEN
    RETURN QUERY SELECT v_a.id, v_b.id;
  ELSE
    RETURN QUERY SELECT v_b.id, v_a.id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION ledger_link_transfer(uuid, uuid, bigint, date, text, timestamptz) TO authenticated;
