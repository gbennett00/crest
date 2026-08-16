-- Bulk-write RPCs for large imports (e.g. the YNAB CSV importer). Both are
-- additive — no existing function/table behavior changes — so the single-row
-- upsertTransaction/upsertCategoryBudget paths are untouched and keep working
-- for manual entry and Plaid sync.
--
-- transactions_account_imported_id_unique and monthly_budgets_month_category_unique
-- are both PARTIAL unique indexes (WHERE imported_id/category_id IS NOT NULL), so
-- PostgREST's generic .upsert() can't target them (it can't restate the index's
-- WHERE predicate on the ON CONFLICT clause) — that's why these need real SQL
-- functions rather than a plain bulk .upsert() call from the client.

-- ---------------------------------------------------------------------------
-- Bulk transaction + allocation upsert
-- ---------------------------------------------------------------------------
--
-- Accepts a JSON array of rows (each shaped like UpsertTransactionInput) and
-- performs the same insert-or-update + replace-allocations + set-approval
-- dance as upsertTransaction/ledger_replace_allocations, but set-based for the
-- whole batch in one round trip. This is safe under the same deferred
-- constraint triggers as the single-row path: transactions_approved_require_allocations
-- and transaction_allocations_sum_matches_txn are DEFERRABLE INITIALLY DEFERRED,
-- so they're only checked once at COMMIT of this function's transaction — by
-- which point every row's final state (transaction + allocations + approval)
-- is already consistent, for the whole batch at once.
--
-- Fails the whole batch on any bad row (by design — see the CLAUDE session
-- this shipped in) but names the offending row (idx + imported_id) so the
-- caller can identify and fix/retry it rather than guessing.
CREATE OR REPLACE FUNCTION ledger_bulk_upsert_transactions(p_rows jsonb)
RETURNS TABLE (idx int, transaction_id uuid, created boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  v_bad_idx int;
  v_bad_imported_id text;
BEGIN
  CREATE TEMP TABLE _bulk_txn_input ON COMMIT DROP AS
  SELECT * FROM jsonb_to_recordset(p_rows) AS t(
    idx int,
    account_id uuid,
    amount_cents bigint,
    txn_date date,
    payee text,
    memo text,
    imported_id text,
    cleared_at timestamptz,
    approved_at timestamptz,
    allocations jsonb
  );

  -- Defense-in-depth validation ahead of the deferred triggers: the triggers
  -- fire once per offending physical row and don't name which import row that
  -- was, which isn't good enough for "tell the user what to fix." idx must be
  -- table-qualified below — RETURNS TABLE(idx, ...) makes `idx` a PL/pgSQL OUT
  -- variable too, and a bare reference is ambiguous between the two.
  SELECT _bulk_txn_input.idx, _bulk_txn_input.imported_id INTO v_bad_idx, v_bad_imported_id
  FROM _bulk_txn_input
  WHERE approved_at IS NOT NULL
    AND (allocations IS NULL OR jsonb_array_length(allocations) = 0)
  LIMIT 1;

  IF v_bad_idx IS NOT NULL THEN
    RAISE EXCEPTION 'ledger_bulk_upsert_transactions: row % (imported_id %) is approved but has no allocations',
      v_bad_idx, v_bad_imported_id;
  END IF;

  SELECT i.idx, i.imported_id INTO v_bad_idx, v_bad_imported_id
  FROM _bulk_txn_input i
  WHERE allocations IS NOT NULL AND jsonb_array_length(allocations) > 0
    AND amount_cents IS DISTINCT FROM (
      SELECT SUM((a->>'amount_cents')::bigint) FROM jsonb_array_elements(i.allocations) a
    )
  LIMIT 1;

  IF v_bad_idx IS NOT NULL THEN
    RAISE EXCEPTION 'ledger_bulk_upsert_transactions: row % (imported_id %) allocations do not sum to amount_cents',
      v_bad_idx, v_bad_imported_id;
  END IF;

  CREATE TEMP TABLE _bulk_txn_result ON COMMIT DROP AS
  WITH upserted AS (
    INSERT INTO transactions (
      account_id, amount_cents, txn_date, payee, memo, imported_id, cleared_at, approved_at
    )
    SELECT account_id, amount_cents, txn_date, payee, memo, imported_id, cleared_at, NULL
    FROM _bulk_txn_input
    ON CONFLICT (account_id, imported_id) WHERE imported_id IS NOT NULL DO UPDATE SET
      amount_cents = EXCLUDED.amount_cents,
      txn_date = EXCLUDED.txn_date,
      payee = EXCLUDED.payee,
      memo = EXCLUDED.memo,
      cleared_at = EXCLUDED.cleared_at
      -- approved_at is deliberately left alone here; set in bulk once
      -- allocations are in place below, same ordering as the single-row path.
    RETURNING id, account_id, imported_id, (xmax = 0) AS was_created
  )
  SELECT i.idx, u.id AS transaction_id, u.was_created
  FROM upserted u
  JOIN _bulk_txn_input i ON i.account_id = u.account_id AND i.imported_id = u.imported_id;

  DELETE FROM transaction_allocations
  WHERE transaction_allocations.transaction_id IN (
    SELECT _bulk_txn_result.transaction_id FROM _bulk_txn_result
  );

  INSERT INTO transaction_allocations (transaction_id, category_id, amount_cents)
  SELECT r.transaction_id, (a->>'category_id')::uuid, (a->>'amount_cents')::bigint
  FROM _bulk_txn_result r
  JOIN _bulk_txn_input i ON i.idx = r.idx
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.allocations, '[]'::jsonb)) a;

  UPDATE transactions t
  SET approved_at = i.approved_at
  FROM _bulk_txn_result r
  JOIN _bulk_txn_input i ON i.idx = r.idx
  WHERE t.id = r.transaction_id
    AND t.approved_at IS DISTINCT FROM i.approved_at;

  RETURN QUERY SELECT r.idx, r.transaction_id, r.was_created FROM _bulk_txn_result r;
END;
$$;

-- ---------------------------------------------------------------------------
-- Bulk category-budget (monthly_budgets) upsert
-- ---------------------------------------------------------------------------
--
-- No deferred-trigger complexity here — just a straight set-based upsert
-- against the partial unique index, which is why it doesn't need plpgsql.
CREATE OR REPLACE FUNCTION ledger_bulk_upsert_category_budgets(p_rows jsonb)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO monthly_budgets (month, category_id, group_id, assigned_cents)
  SELECT month, category_id, NULL, assigned_cents
  FROM jsonb_to_recordset(p_rows) AS t(month date, category_id uuid, assigned_cents bigint)
  ON CONFLICT (month, category_id) WHERE category_id IS NOT NULL DO UPDATE SET
    assigned_cents = EXCLUDED.assigned_cents;
$$;

GRANT EXECUTE ON FUNCTION ledger_bulk_upsert_transactions(jsonb)      TO authenticated;
GRANT EXECUTE ON FUNCTION ledger_bulk_upsert_category_budgets(jsonb)  TO authenticated;
