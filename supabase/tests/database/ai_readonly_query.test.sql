-- Read-only SQL runner for the Ask page (migration 20261109120000). Run with
-- `supabase test db`.
--
-- Every write attempt runs inside throws_ok's subtransaction, which rolls back
-- the read-only switch along with the error. A *successful* call leaves the
-- test transaction read-only, so all fixtures are written up front.
BEGIN;
SELECT plan(17);

INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('40000000-0000-0000-0000-00000000000a', 'ask-a@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('40000000-0000-0000-0000-00000000000b', 'ask-b@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

-- A group in each plan, so plan scoping is observable.
INSERT INTO category_groups (name, budget_mode, plan_id)
SELECT 'Ask ' || u.email, 'category', m.plan_id
FROM auth.users u JOIN plan_members m ON m.user_id = u.id
WHERE u.id IN ('40000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000b');

INSERT INTO plaid_items (plan_id, plaid_item_id, access_token)
SELECT plan_id, 'item-ask', 'access-secret'
FROM plan_members WHERE user_id = '40000000-0000-0000-0000-00000000000a';

CREATE FUNCTION pg_temp.act_as(p_user uuid, p_email text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'email', p_email)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

SELECT pg_temp.act_as('40000000-0000-0000-0000-00000000000a', 'ask-a@test.dev');

-- ---------------------------------------------------------------------------
-- Writes are impossible
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$SELECT ai_readonly_query('INSERT INTO category_groups (name, budget_mode, plan_id) SELECT ''x'', ''category'', plan_id FROM category_groups LIMIT 1')$$,
  '42601', NULL, 'a bare INSERT is not a valid subquery');

SELECT throws_ok(
  $$SELECT ai_readonly_query('WITH d AS (DELETE FROM category_groups RETURNING id) SELECT * FROM d')$$,
  '0A000', NULL, 'a data-modifying CTE is rejected');

SELECT throws_ok(
  $$SELECT ai_readonly_query('SELECT 1; DELETE FROM category_groups')$$,
  '42601', 'only a single statement is allowed (remove the semicolons)',
  'stacked statements are rejected');

SELECT throws_ok(
  $$SELECT ai_readonly_query('SELECT set_active_plan(plan_id) FROM category_groups')$$,
  '25006', NULL, 'a volatile function that writes fails in the read-only transaction');

SELECT throws_ok(
  $$SELECT ai_readonly_query('SELECT * FROM category_groups FOR UPDATE')$$,
  '25006', NULL, 'row locks are refused');

SELECT throws_ok(
  $$SELECT ai_readonly_query('SELECT set_config(''transaction_read_only'', ''off'', true)')$$,
  '25001', NULL, 'the query cannot switch the transaction back to read-write');

-- ---------------------------------------------------------------------------
-- Secret-bearing tables and other schemas are off limits
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$SELECT ai_readonly_query('SELECT access_token FROM plaid_items')$$,
  '42501', 'reading from "plaid_items" is not allowed', 'plaid_items is blocked');

SELECT throws_ok(
  $$SELECT ai_readonly_query('WITH t AS (SELECT * FROM plaid_items) SELECT count(*) FROM t')$$,
  '42501', 'reading from "plaid_items" is not allowed', 'plaid_items is blocked inside a CTE');

SELECT throws_ok(
  $$SELECT ai_readonly_query('SELECT * FROM push_subscriptions')$$,
  '42501', NULL, 'push_subscriptions is blocked');

SELECT throws_ok(
  $$SELECT ai_readonly_query('SELECT token FROM plan_invitations')$$,
  '42501', NULL, 'plan_invitations is blocked');

SELECT throws_ok(
  $$SELECT ai_readonly_query('SELECT email FROM auth.users')$$,
  '42501', NULL, 'other schemas are blocked');

SELECT throws_ok(
  $$SELECT ai_readonly_query('   ;  ')$$,
  '42601', 'query is empty', 'an empty query is rejected');

-- ---------------------------------------------------------------------------
-- Reads work, are plan-scoped and capped (each success leaves the txn r/o)
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT ai_readonly_query('SELECT name FROM category_groups WHERE name LIKE ''Ask %''') -> 'rows')::jsonb,
  '[{"name": "Ask ask-a@test.dev"}]'::jsonb,
  'RLS limits results to the caller''s plan');

SELECT is(
  ai_readonly_query('SELECT n FROM generate_series(1, 10) AS n ORDER BY n', 3)::jsonb,
  '{"rows": [{"n": 1}, {"n": 2}, {"n": 3}], "truncated": true}'::jsonb,
  'rows past the cap are dropped and flagged');

SELECT is(
  ai_readonly_query(E'SELECT 1 AS one; \n')::jsonb,
  '{"rows": [{"one": 1}], "truncated": false}'::jsonb,
  'a trailing semicolon is allowed');

SELECT is(
  ai_readonly_query('SELECT 2 AS two -- trailing comment')::jsonb,
  '{"rows": [{"two": 2}], "truncated": false}'::jsonb,
  'a trailing line comment does not break the wrapper');

SELECT is(current_setting('transaction_read_only'), 'on',
  'the calling transaction is left read-only');

SELECT * FROM finish();
ROLLBACK;
