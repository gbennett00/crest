-- The bulk import RPCs previously overwrote categorization/assignment
-- decisions on every re-run, even for rows that already existed before that
-- run — so re-running the YNAB importer after manually recategorizing a
-- transaction (or editing a monthly assignment) in the app silently reverted
-- that edit back to whatever the CSV originally said. Fix: only set
-- allocations/approval/amount/date on rows the RPC actually creates;
-- existing rows keep whatever the app already has for them. Amount and date
-- have to be frozen alongside allocations (not just categorization) because
-- transaction_allocations must sum to amount_cents once a transaction is
-- approved (deferred constraint trigger) — refreshing amount_cents on an
-- existing row without also touching its (intentionally untouched)
-- allocations would violate that invariant. Only cosmetic fields that can't
-- desync anything (payee, memo, cleared status) refresh on every run.

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
      payee = EXCLUDED.payee,
      memo = EXCLUDED.memo,
      cleared_at = EXCLUDED.cleared_at
      -- amount_cents, txn_date and approved_at are deliberately left alone
      -- here; amount/date are financial content tied to the allocations
      -- invariant above, and approved_at is set below only for
      -- newly-created rows (see was_created filtering).
    RETURNING id, account_id, imported_id, (xmax = 0) AS was_created
  )
  SELECT i.idx, u.id AS transaction_id, u.was_created
  FROM upserted u
  JOIN _bulk_txn_input i ON i.account_id = u.account_id AND i.imported_id = u.imported_id;

  -- Categorization and approval are a user decision once a transaction
  -- exists — only set them here for rows this call is creating for the
  -- first time. A pre-existing row's allocations/approval are left exactly
  -- as they are in the app, no matter what this batch's input says.
  DELETE FROM transaction_allocations
  WHERE transaction_allocations.transaction_id IN (
    SELECT _bulk_txn_result.transaction_id FROM _bulk_txn_result WHERE _bulk_txn_result.was_created
  );

  INSERT INTO transaction_allocations (transaction_id, category_id, amount_cents)
  SELECT r.transaction_id, (a->>'category_id')::uuid, (a->>'amount_cents')::bigint
  FROM _bulk_txn_result r
  JOIN _bulk_txn_input i ON i.idx = r.idx
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.allocations, '[]'::jsonb)) a
  WHERE r.was_created;

  UPDATE transactions t
  SET approved_at = i.approved_at
  FROM _bulk_txn_result r
  JOIN _bulk_txn_input i ON i.idx = r.idx
  WHERE t.id = r.transaction_id
    AND r.was_created
    AND t.approved_at IS DISTINCT FROM i.approved_at;

  RETURN QUERY SELECT r.idx, r.transaction_id, r.was_created FROM _bulk_txn_result r;
END;
$$;

-- Same principle for monthly assignments: once a row exists, a re-run of the
-- importer leaves its assigned_cents alone rather than reverting a manual
-- edit made in the Budget page after import.
CREATE OR REPLACE FUNCTION ledger_bulk_upsert_category_budgets(p_rows jsonb)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO monthly_budgets (month, category_id, group_id, assigned_cents)
  SELECT month, category_id, NULL, assigned_cents
  FROM jsonb_to_recordset(p_rows) AS t(month date, category_id uuid, assigned_cents bigint)
  ON CONFLICT (month, category_id) WHERE category_id IS NOT NULL DO NOTHING;
$$;
