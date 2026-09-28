-- Budget moves ledger (migration 20260928120000). Run with `supabase test db`.
BEGIN;
SELECT plan(32);

-- ---------------------------------------------------------------------------
-- Fixtures: two users, each with a plan (created by on_auth_user_created)
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('10000000-0000-0000-0000-00000000000a', 'moves-a@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('10000000-0000-0000-0000-00000000000b', 'moves-b@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

CREATE TEMP TABLE fx (key text PRIMARY KEY, id uuid);
GRANT SELECT ON fx TO authenticated;

INSERT INTO fx
SELECT 'plan_a', plan_id FROM plan_members WHERE user_id = '10000000-0000-0000-0000-00000000000a'
UNION ALL
SELECT 'plan_b', plan_id FROM plan_members WHERE user_id = '10000000-0000-0000-0000-00000000000b';

INSERT INTO fx SELECT 'rta_a', ready_to_assign_category_id((SELECT id FROM fx WHERE key = 'plan_a'));
INSERT INTO fx SELECT 'rta_b', ready_to_assign_category_id((SELECT id FROM fx WHERE key = 'plan_b'));

WITH g AS (
  INSERT INTO category_groups (name, budget_mode, plan_id)
  VALUES ('Bills', 'category', (SELECT id FROM fx WHERE key = 'plan_a'))
  RETURNING id
) INSERT INTO fx SELECT 'bills_a', id FROM g;
WITH g AS (
  INSERT INTO category_groups (name, budget_mode, plan_id)
  VALUES ('Fun', 'group', (SELECT id FROM fx WHERE key = 'plan_a'))
  RETURNING id
) INSERT INTO fx SELECT 'fun_a', id FROM g;
WITH g AS (
  INSERT INTO category_groups (name, budget_mode, plan_id)
  VALUES ('Bills', 'category', (SELECT id FROM fx WHERE key = 'plan_b'))
  RETURNING id
) INSERT INTO fx SELECT 'bills_b', id FROM g;

WITH c AS (
  INSERT INTO categories (name, group_id) VALUES ('Rent', (SELECT id FROM fx WHERE key = 'bills_a')) RETURNING id
) INSERT INTO fx SELECT 'rent_a', id FROM c;
WITH c AS (
  INSERT INTO categories (name, group_id) VALUES ('Groceries', (SELECT id FROM fx WHERE key = 'bills_a')) RETURNING id
) INSERT INTO fx SELECT 'groceries_a', id FROM c;
WITH c AS (
  INSERT INTO categories (name, group_id) VALUES ('Rent', (SELECT id FROM fx WHERE key = 'bills_b')) RETURNING id
) INSERT INTO fx SELECT 'rent_b', id FROM c;

CREATE FUNCTION pg_temp.fx(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fx WHERE key = k $$;

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

CREATE FUNCTION pg_temp.assigned(p_month date, p_category uuid, p_group uuid) RETURNS bigint
LANGUAGE sql AS $$
  SELECT COALESCE(SUM(assigned_cents), 0)::bigint FROM monthly_budgets
  WHERE month = p_month
    AND category_id IS NOT DISTINCT FROM p_category
    AND group_id IS NOT DISTINCT FROM p_group
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

-- ---------------------------------------------------------------------------
-- ledger_set_assigned: absolute amounts become RTA moves
-- ---------------------------------------------------------------------------

SELECT pg_temp.act_as('10000000-0000-0000-0000-00000000000a');

SELECT lives_ok(
  format($$SELECT ledger_set_assigned('[{"month":"2026-09-01","category_id":"%s","assigned_cents":50000}]')$$,
    pg_temp.fx('rent_a')),
  'set_assigned from 0 to 500.00');

SELECT is(pg_temp.assigned('2026-09-01', pg_temp.fx('rent_a'), NULL), 50000::bigint,
  'view shows the new assigned total');

SELECT results_eq(
  format($$SELECT from_category_id, to_category_id, amount_cents, source::text, created_by, plan_id
           FROM budget_moves WHERE to_category_id = '%s'$$, pg_temp.fx('rent_a')),
  format($$VALUES ('%s'::uuid, '%s'::uuid, 50000::bigint, 'user', '10000000-0000-0000-0000-00000000000a'::uuid, '%s'::uuid)$$,
    pg_temp.fx('rta_a'), pg_temp.fx('rent_a'), pg_temp.fx('plan_a')),
  'increase is recorded as RTA -> category, attributed to the caller, plan derived');

SELECT lives_ok(
  format($$SELECT ledger_set_assigned('[{"month":"2026-09-01","category_id":"%s","assigned_cents":42000}]')$$,
    pg_temp.fx('rent_a')),
  'set_assigned down to 420.00');

SELECT results_eq(
  format($$SELECT from_category_id, to_category_id, amount_cents FROM budget_moves
           WHERE from_category_id = '%s'$$, pg_temp.fx('rent_a')),
  format($$VALUES ('%s'::uuid, '%s'::uuid, 8000::bigint)$$, pg_temp.fx('rent_a'), pg_temp.fx('rta_a')),
  'decrease is recorded as category -> RTA for the difference');

SELECT is(pg_temp.assigned('2026-09-01', pg_temp.fx('rent_a'), NULL), 42000::bigint,
  'view reflects the decrease');

SELECT ledger_set_assigned(format(
  '[{"month":"2026-09-01","category_id":"%s","assigned_cents":42000}]', pg_temp.fx('rent_a'))::jsonb);
SELECT is((SELECT count(*) FROM budget_moves), 2::bigint, 'unchanged amount writes no move');

SELECT lives_ok(
  format($$SELECT ledger_set_assigned('[{"month":"2026-09-01","group_id":"%s","assigned_cents":-1500}]')$$,
    pg_temp.fx('fun_a')),
  'set_assigned on a group-budgeted group (negative)');

SELECT is(pg_temp.assigned('2026-09-01', NULL, pg_temp.fx('fun_a')), -1500::bigint,
  'group total derived from group-side moves');

SELECT throws_ok(
  format($$SELECT ledger_set_assigned('[{"month":"2026-09-01","category_id":"%s","assigned_cents":100}]')$$,
    pg_temp.fx('rta_a')),
  'P0001', 'cannot assign directly to Ready to Assign',
  'assigning to RTA itself is rejected');

SELECT throws_ok(
  format($$SELECT ledger_set_assigned('[{"month":"2026-09-15","category_id":"%s","assigned_cents":100}]')$$,
    pg_temp.fx('rent_a')),
  '23514', NULL,
  'month must be the first day');

-- ---------------------------------------------------------------------------
-- ledger_move_money: explicit pairs, RTA side resolved when omitted
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  format($$SELECT ledger_move_money('[{"month":"2026-09-01","from_category_id":"%s","to_category_id":"%s","amount_cents":2000}]', 'cover')$$,
    pg_temp.fx('rent_a'), pg_temp.fx('groceries_a')),
  'move category -> category');

SELECT is(pg_temp.assigned('2026-09-01', pg_temp.fx('rent_a'), NULL), 40000::bigint, 'source decreased');
SELECT is(pg_temp.assigned('2026-09-01', pg_temp.fx('groceries_a'), NULL), 2000::bigint, 'destination increased');

SELECT lives_ok(
  format($$SELECT ledger_move_money('[{"month":"2026-09-01","to_group_id":"%s","amount_cents":1500}]', 'cover')$$,
    pg_temp.fx('fun_a')),
  'move with omitted source pulls from RTA');

SELECT is(
  (SELECT from_category_id FROM budget_moves WHERE to_group_id = pg_temp.fx('fun_a')),
  pg_temp.fx('rta_a'),
  'omitted side stored as the plan''s RTA category id');

SELECT is(pg_temp.assigned('2026-09-01', NULL, pg_temp.fx('fun_a')), 0::bigint, 'group covered back to zero');

SELECT is((SELECT count(*) FROM monthly_budgets WHERE category_id = pg_temp.fx('rta_a')), 0::bigint,
  'RTA never appears in monthly_budgets');

SELECT throws_ok(
  format($$SELECT ledger_move_money('[{"month":"2026-09-01","from_category_id":"%s","to_category_id":"%s","amount_cents":0}]')$$,
    pg_temp.fx('rent_a'), pg_temp.fx('groceries_a')),
  '23514', NULL,
  'zero amount rejected');

SELECT throws_ok(
  format($$SELECT ledger_move_money('[{"month":"2026-09-01","from_category_id":"%s","to_category_id":"%s","amount_cents":100}]')$$,
    pg_temp.fx('rent_a'), pg_temp.fx('rent_a')),
  '23514', NULL,
  'moving a unit to itself rejected');

-- ---------------------------------------------------------------------------
-- Authorship, isolation, append-only
-- ---------------------------------------------------------------------------

INSERT INTO budget_moves (month, moved_at, from_category_id, to_category_id, amount_cents, source, created_by)
VALUES ('2026-09-01', '2020-01-01', pg_temp.fx('rta_a'), pg_temp.fx('rent_a'), 1, 'user',
        '10000000-0000-0000-0000-00000000000b');
SELECT results_eq(
  $$SELECT created_by, moved_at > now() - interval '1 minute' FROM budget_moves WHERE amount_cents = 1$$,
  $$VALUES ('10000000-0000-0000-0000-00000000000a'::uuid, true)$$,
  'direct insert cannot spoof created_by or moved_at');

SELECT throws_ok(
  $$UPDATE budget_moves SET amount_cents = 99$$, '42501', NULL, 'moves cannot be updated');
SELECT throws_ok(
  $$DELETE FROM budget_moves$$, '42501', NULL, 'moves cannot be deleted');

SELECT throws_ok(
  format($$SELECT ledger_move_money('[{"month":"2026-09-01","from_category_id":"%s","to_category_id":"%s","amount_cents":100}]')$$,
    pg_temp.fx('rent_a'), pg_temp.fx('rent_b')),
  'P0001', 'budget move source and destination belong to different plans',
  'cannot move into another user''s plan');

SELECT throws_ok(
  format($$SELECT ledger_move_money('[{"month":"2026-09-01","to_category_id":"%s","amount_cents":100}]')$$,
    pg_temp.fx('rent_b')),
  '42501', NULL,
  'cannot move money within a plan you are not a member of');

SELECT pg_temp.act_as('10000000-0000-0000-0000-00000000000b');
SELECT is((SELECT count(*) FROM budget_moves), 0::bigint, 'other plan members see none of A''s moves');
SELECT is((SELECT count(*) FROM monthly_budgets), 0::bigint, 'nor A''s assigned totals');

RESET ROLE;

-- Even without RLS (service role / migrations), plans can't be mixed.
SELECT throws_ok(
  format($$INSERT INTO budget_moves (month, from_category_id, to_category_id, amount_cents, source)
           VALUES ('2026-09-01', '%s', '%s', 100, 'user')$$, pg_temp.fx('rent_a'), pg_temp.fx('rent_b')),
  'P0001', 'budget move source and destination belong to different plans',
  'cross-plan moves rejected by the trigger');

-- ---------------------------------------------------------------------------
-- YNAB import: only fills (month, category) pairs with no moves yet
-- ---------------------------------------------------------------------------

SELECT pg_temp.act_as('10000000-0000-0000-0000-00000000000a');
SELECT ledger_bulk_upsert_category_budgets(format(
  '[{"month":"2026-09-01","category_id":"%1$s","assigned_cents":99999},
    {"month":"2026-08-01","category_id":"%1$s","assigned_cents":-300},
    {"month":"2026-07-01","category_id":"%1$s","assigned_cents":0}]',
  pg_temp.fx('rent_a'))::jsonb);

SELECT is(pg_temp.assigned('2026-09-01', pg_temp.fx('rent_a'), NULL), 40001::bigint,
  'import leaves a month that already has moves alone');
SELECT is(pg_temp.assigned('2026-08-01', pg_temp.fx('rent_a'), NULL), -300::bigint,
  'import records a negative amount for an untouched month');
SELECT is((SELECT count(*) FROM budget_moves WHERE source = 'import'), 1::bigint,
  'zero-amount import rows write nothing');

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Plan deletion still tears everything down
-- ---------------------------------------------------------------------------

DELETE FROM plans WHERE id = pg_temp.fx('plan_a');
SELECT is((SELECT count(*) FROM budget_moves WHERE plan_id = pg_temp.fx('plan_a')), 0::bigint,
  'deleting a plan removes its moves');

SELECT * FROM finish();
ROLLBACK;
