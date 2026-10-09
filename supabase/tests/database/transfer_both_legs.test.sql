-- ledger_create_transfer always yields a txn on both sides (migration
-- 20261009120000). Run with `supabase test db`.
BEGIN;
SELECT plan(7);

INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('30000000-0000-0000-0000-00000000000a', 'xfer@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

CREATE TEMP TABLE fx (key text PRIMARY KEY, id uuid);

INSERT INTO fx SELECT 'plan', plan_id FROM plan_members
WHERE user_id = '30000000-0000-0000-0000-00000000000a';

WITH a AS (
  INSERT INTO accounts (name, type, plan_id) VALUES ('Checking', 'checking', (SELECT id FROM fx WHERE key = 'plan')) RETURNING id
) INSERT INTO fx SELECT 'checking', id FROM a;
WITH a AS (
  INSERT INTO accounts (name, type, plan_id) VALUES ('Savings', 'savings', (SELECT id FROM fx WHERE key = 'plan')) RETURNING id
) INSERT INTO fx SELECT 'savings', id FROM a;

-- Fresh transfer creates both legs.
CREATE TEMP TABLE r1 AS
SELECT * FROM ledger_create_transfer(
  (SELECT id FROM fx WHERE key = 'checking'), (SELECT id FROM fx WHERE key = 'savings'),
  200000, '2026-09-08', 'Transfer', NULL, NULL, 'csv:t1');

SELECT is((SELECT created FROM r1), true, 'first call creates the transfer');
SELECT is((SELECT count(*)::int FROM transactions WHERE imported_id = 'csv:t1'), 2, 'both legs exist');
SELECT is(
  (SELECT sum(amount_cents)::int FROM transactions WHERE imported_id = 'csv:t1'), 0,
  'legs are equal and opposite');

-- Re-run with both legs present is a no-op.
SELECT is(
  (SELECT created FROM ledger_create_transfer(
    (SELECT id FROM fx WHERE key = 'checking'), (SELECT id FROM fx WHERE key = 'savings'),
    200000, '2026-09-08', 'Transfer', NULL, NULL, 'csv:t1')),
  false, 're-run returns the existing pair');
SELECT is((SELECT count(*)::int FROM transactions WHERE imported_id = 'csv:t1'), 2, 're-run adds no rows');

-- Orphan one leg: a re-run must refuse rather than duplicate the survivor.
DELETE FROM transactions
WHERE imported_id = 'csv:t1' AND account_id = (SELECT id FROM fx WHERE key = 'savings');

SELECT throws_like(
  $$SELECT * FROM ledger_create_transfer(
    (SELECT id FROM fx WHERE key = 'checking'), (SELECT id FROM fx WHERE key = 'savings'),
    200000, '2026-09-08', 'Transfer', NULL, NULL, 'csv:t1')$$,
  '%half-present%', 're-run over a half-transfer raises');
SELECT is((SELECT count(*)::int FROM transactions WHERE imported_id = 'csv:t1'), 1, 'no duplicate leg was inserted');

SELECT * FROM finish();
ROLLBACK;
