-- Atomic allocation replacement: delete + insert in a single transaction so the
-- deferred split-sum constraint never sees an intermediate invalid state.
-- Called by application code whenever allocations change on their own.
CREATE OR REPLACE FUNCTION ledger_replace_allocations(
  p_transaction_id uuid,
  p_allocations     jsonb  -- [{category_id: uuid, amount_cents: bigint}]
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM transaction_allocations WHERE transaction_id = p_transaction_id;

  IF jsonb_array_length(p_allocations) > 0 THEN
    INSERT INTO transaction_allocations (transaction_id, category_id, amount_cents)
    SELECT
      p_transaction_id,
      (elem->>'category_id')::uuid,
      (elem->>'amount_cents')::bigint
    FROM jsonb_array_elements(p_allocations) AS elem;
  END IF;
END;
$$;

-- Atomic amount + allocation update.  Both the UPDATE and the allocation
-- replacement run in one transaction so all deferred triggers fire at commit
-- and see a fully-consistent state (amount_cents == sum of new allocations).
CREATE OR REPLACE FUNCTION ledger_update_amount_and_allocations(
  p_transaction_id uuid,
  p_amount_cents    bigint,
  p_allocations     jsonb  -- [{category_id: uuid, amount_cents: bigint}]
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE transactions SET amount_cents = p_amount_cents WHERE id = p_transaction_id;

  DELETE FROM transaction_allocations WHERE transaction_id = p_transaction_id;

  IF jsonb_array_length(p_allocations) > 0 THEN
    INSERT INTO transaction_allocations (transaction_id, category_id, amount_cents)
    SELECT
      p_transaction_id,
      (elem->>'category_id')::uuid,
      (elem->>'amount_cents')::bigint
    FROM jsonb_array_elements(p_allocations) AS elem;
  END IF;
END;
$$;

-- Redeclare as DEFERRABLE INITIALLY DEFERRED so ledger_update_amount_and_allocations
-- can change amount_cents and replace allocations in one transaction without the
-- trigger firing mid-procedure against a temporarily-inconsistent allocation sum.
DROP TRIGGER transactions_amount_or_approval_recheck_splits ON transactions;

CREATE CONSTRAINT TRIGGER transactions_amount_or_approval_recheck_splits
  AFTER UPDATE OF amount_cents, approved_at ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION enforce_transaction_splits_sum_on_txn_update();
