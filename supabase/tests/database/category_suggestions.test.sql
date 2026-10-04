-- Auto-categorization (migration 20261005120000). Run with `supabase test db`.
BEGIN;
SELECT plan(53);

-- ---------------------------------------------------------------------------
-- normalize_payee
-- ---------------------------------------------------------------------------

SELECT is(normalize_payee('MAVERIK #117'), 'maverik', 'strips "#123" store numbers');
SELECT is(normalize_payee('Maverik # 42'), 'maverik', 'strips "# 42" with a space');
SELECT is(normalize_payee('Chevron 0204513'), 'chevron', 'strips trailing digit words');
SELECT is(normalize_payee('Walmart Store 1234'), 'walmart', 'strips "store 1234"');
SELECT is(normalize_payee('Trader Joe''s'), 'trader joes', 'drops apostrophes');
SELECT is(normalize_payee('  7-Eleven  '), '7 eleven', 'punctuation becomes a space, keeps leading digits');
SELECT is(normalize_payee('76'), '76', 'an all-digit payee is kept');
SELECT is(normalize_payee('H&M'), 'h&m', 'keeps ampersands');
SELECT is(normalize_payee(''), NULL, 'empty payee has no key');
SELECT is(normalize_payee('#5'), NULL, 'a payee of only a store number has no key');

-- ---------------------------------------------------------------------------
-- Fixtures: two users, each with a plan (created by on_auth_user_created)
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('20000000-0000-0000-0000-00000000000a', 'suggest-a@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('20000000-0000-0000-0000-00000000000b', 'suggest-b@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

CREATE TEMP TABLE fx (key text PRIMARY KEY, id uuid);
GRANT SELECT ON fx TO authenticated;

INSERT INTO fx
SELECT 'plan_a', plan_id FROM plan_members WHERE user_id = '20000000-0000-0000-0000-00000000000a'
UNION ALL
SELECT 'plan_b', plan_id FROM plan_members WHERE user_id = '20000000-0000-0000-0000-00000000000b';

CREATE FUNCTION pg_temp.fx(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fx WHERE key = k $$;

INSERT INTO fx SELECT 'rta_a', ready_to_assign_category_id(pg_temp.fx('plan_a'));

WITH g AS (
  INSERT INTO category_groups (name, budget_mode, plan_id)
  VALUES ('Everyday', 'category', pg_temp.fx('plan_a')) RETURNING id
) INSERT INTO fx SELECT 'group_a', id FROM g;
WITH g AS (
  INSERT INTO category_groups (name, budget_mode, plan_id)
  VALUES ('Everyday', 'category', pg_temp.fx('plan_b')) RETURNING id
) INSERT INTO fx SELECT 'group_b', id FROM g;

CREATE FUNCTION pg_temp.cat(k text, p_name text, p_group text, p_hidden boolean DEFAULT false)
RETURNS void LANGUAGE sql AS $$
  WITH c AS (
    INSERT INTO categories (name, group_id, is_hidden)
    VALUES (p_name, pg_temp.fx(p_group), p_hidden) RETURNING id
  ) INSERT INTO fx SELECT k, id FROM c;
$$;

SELECT pg_temp.cat('allowance', 'Zoie''s allowance', 'group_a');
SELECT pg_temp.cat('transport', 'Transportation', 'group_a');
SELECT pg_temp.cat('groceries', 'Groceries', 'group_a');
SELECT pg_temp.cat('clothing', 'Clothing', 'group_a');
SELECT pg_temp.cat('archived', 'Old stuff', 'group_a', true);
SELECT pg_temp.cat('groceries_b', 'Groceries', 'group_b');

WITH a AS (
  INSERT INTO accounts (name, type, plan_id) VALUES ('Checking', 'checking', pg_temp.fx('plan_a')) RETURNING id
) INSERT INTO fx SELECT 'checking', id FROM a;
WITH a AS (
  INSERT INTO accounts (name, type, plan_id) VALUES ('Savings', 'savings', pg_temp.fx('plan_a')) RETURNING id
) INSERT INTO fx SELECT 'savings', id FROM a;
WITH a AS (
  INSERT INTO accounts (name, type, plan_id) VALUES ('House', 'asset', pg_temp.fx('plan_a')) RETURNING id
) INSERT INTO fx SELECT 'house', id FROM a;
WITH a AS (
  INSERT INTO accounts (name, type, plan_id) VALUES ('Checking', 'checking', pg_temp.fx('plan_b')) RETURNING id
) INSERT INTO fx SELECT 'checking_b', id FROM a;

-- A transaction; approved with the given categories (each for an equal share)
-- when any are passed, otherwise left pending and uncategorized.
CREATE FUNCTION pg_temp.txn(
  p_payee text, p_amount bigint, p_date date,
  p_categories text[] DEFAULT NULL, p_account text DEFAULT 'checking'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_n int := coalesce(array_length(p_categories, 1), 0);
BEGIN
  INSERT INTO transactions (account_id, amount_cents, txn_date, payee)
  VALUES (pg_temp.fx(p_account), p_amount, p_date, p_payee)
  RETURNING id INTO v_id;
  IF v_n > 0 THEN
    INSERT INTO transaction_allocations (transaction_id, category_id, amount_cents)
    SELECT v_id, pg_temp.fx(k), p_amount / v_n FROM unnest(p_categories) AS k;
    UPDATE transactions SET approved_at = now() WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.suggest(VARIADIC p_ids uuid[]) RETURNS integer
LANGUAGE sql AS $$ SELECT ledger_apply_category_suggestions(p_ids) $$;

-- The single suggested category (null when uncategorized or split).
CREATE FUNCTION pg_temp.category_of(p_txn uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(category_id))[1] END
  FROM transaction_allocations WHERE transaction_id = p_txn
$$;

CREATE FUNCTION pg_temp.source_of(p_txn uuid) RETURNS text LANGUAGE sql AS $$
  SELECT category_source::text FROM transactions WHERE id = p_txn
$$;

CREATE FUNCTION pg_temp.rule(
  p_text text, p_category text, p_match category_rule_match DEFAULT 'exact',
  p_min bigint DEFAULT NULL, p_max bigint DEFAULT NULL,
  p_direction category_rule_direction DEFAULT 'outflow', p_account text DEFAULT NULL
) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO category_rules
    (plan_id, match_type, match_text, direction, min_cents, max_cents, account_id, category_id)
  VALUES (pg_temp.fx('plan_a'), p_match, p_text, p_direction, p_min, p_max,
          pg_temp.fx(p_account), pg_temp.fx(p_category))
  RETURNING id
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

-- Payee history -------------------------------------------------------------

-- Maverik: 3 of 4 recent purchases were the allowance (75%).
SELECT pg_temp.txn('Maverik', -1200, '2026-09-01', ARRAY['allowance']);
SELECT pg_temp.txn('MAVERIK #117', -900, '2026-09-05', ARRAY['allowance']);
SELECT pg_temp.txn('Maverik', -4500, '2026-09-08', ARRAY['transport']);
SELECT pg_temp.txn('Maverik', -800, '2026-09-12', ARRAY['allowance']);
-- Walmart: an even split between two categories (50%).
SELECT pg_temp.txn('Walmart', -3000, '2026-09-02', ARRAY['groceries']);
SELECT pg_temp.txn('Walmart', -2500, '2026-09-03', ARRAY['clothing']);
-- Costco: a single prior purchase.
SELECT pg_temp.txn('Costco', -15000, '2026-09-04', ARRAY['groceries']);
-- Target: 2 of 3 recent purchases were split, so only 1 of 3 votes is a category.
SELECT pg_temp.txn('Target', -2000, '2026-09-04', ARRAY['groceries']);
SELECT pg_temp.txn('Target', -4000, '2026-09-05', ARRAY['groceries', 'clothing']);
SELECT pg_temp.txn('Target', -4000, '2026-09-06', ARRAY['groceries', 'clothing']);
-- Smith's: history went to a category that has since been archived.
SELECT pg_temp.txn('Smith''s', -5000, '2026-09-04', ARRAY['archived']);
-- Paychecks into Ready to Assign.
SELECT pg_temp.txn('Acme Payroll', 250000, '2026-09-01', ARRAY['rta_a']);
-- Plan B shares a payee but must never inform plan A.
SELECT pg_temp.txn('Kroger', -3000, '2026-09-01', ARRAY['groceries_b'], 'checking_b');

INSERT INTO fx VALUES
  ('mav_new',      pg_temp.txn('MAVERIK #9 SLC', -700, '2026-09-20')),
  ('walmart_new',  pg_temp.txn('Walmart', -4200, '2026-09-20')),
  ('costco_new',   pg_temp.txn('COSTCO #4', -9900, '2026-09-20')),
  ('target_new',   pg_temp.txn('Target', -1000, '2026-09-20')),
  ('smiths_new',   pg_temp.txn('Smith''s', -1000, '2026-09-20')),
  ('mav_refund',   pg_temp.txn('Maverik', 700, '2026-09-20')),
  ('pay_new',      pg_temp.txn('ACME PAYROLL', 250000, '2026-09-20')),
  ('kroger_new',   pg_temp.txn('Kroger', -3000, '2026-09-20')),
  ('mav_house',    pg_temp.txn('Maverik', -700, '2026-09-20', NULL, 'house')),
  ('mav_user',     pg_temp.txn('Maverik', -700, '2026-09-20')),
  ('walmart_approved', pg_temp.txn('Walmart', -700, '2026-09-20', ARRAY['groceries']));

-- A pending row the user already categorized themselves.
INSERT INTO transaction_allocations (transaction_id, category_id, amount_cents)
VALUES (pg_temp.fx('mav_user'), pg_temp.fx('clothing'), -700);

-- MAVERIK #9 SLC normalizes to "maverik slc", not "maverik": history is keyed
-- exactly, so that row is only reachable by a contains rule (tested below).
SELECT is(
  pg_temp.suggest(
    pg_temp.fx('mav_new'), pg_temp.fx('walmart_new'), pg_temp.fx('costco_new'),
    pg_temp.fx('target_new'), pg_temp.fx('smiths_new'), pg_temp.fx('mav_refund'),
    pg_temp.fx('pay_new'), pg_temp.fx('kroger_new'), pg_temp.fx('mav_house'),
    pg_temp.fx('mav_user'), pg_temp.fx('walmart_approved')),
  2, 'history suggests for exactly two rows');

SELECT is(pg_temp.category_of(pg_temp.fx('costco_new')), pg_temp.fx('groceries'),
  'a single prior transaction is enough ("same as last time")');
SELECT is(pg_temp.source_of(pg_temp.fx('costco_new')), 'history', 'tagged as a history suggestion');
SELECT is((SELECT amount_cents FROM transaction_allocations WHERE transaction_id = pg_temp.fx('costco_new')),
  -9900::bigint, 'the suggestion covers the full amount');
SELECT is((SELECT approved_at FROM transactions WHERE id = pg_temp.fx('costco_new')), NULL,
  'a suggestion never approves the transaction');
SELECT is(pg_temp.category_of(pg_temp.fx('pay_new')), pg_temp.fx('rta_a'),
  'inflows can be suggested into Ready to Assign');
SELECT is(pg_temp.category_of(pg_temp.fx('walmart_new')), NULL, 'a payee at 2 of 3 (67%) is too mixed to suggest');
SELECT is(pg_temp.category_of(pg_temp.fx('target_new')), NULL, 'split history counts against a suggestion');
SELECT is(pg_temp.category_of(pg_temp.fx('smiths_new')), NULL, 'an archived category is never suggested');
SELECT is(pg_temp.category_of(pg_temp.fx('mav_refund')), NULL, 'outflow history does not categorize an inflow');
SELECT is(pg_temp.category_of(pg_temp.fx('kroger_new')), NULL, 'another plan''s history is ignored');
SELECT is(pg_temp.category_of(pg_temp.fx('mav_house')), NULL, 'tracking-account rows are never categorized');
SELECT is(pg_temp.category_of(pg_temp.fx('mav_user')), pg_temp.fx('clothing'),
  'a pending row the user categorized is left alone');
SELECT is(pg_temp.category_of(pg_temp.fx('walmart_approved')), pg_temp.fx('groceries'),
  'approved rows are left alone');

-- The 70% threshold, using an exactly-keyed new Maverik row (75% allowance).
INSERT INTO fx VALUES ('mav_hist', pg_temp.txn('Maverik #22', -700, '2026-09-21'));
SELECT pg_temp.suggest(pg_temp.fx('mav_hist'));
SELECT is(pg_temp.category_of(pg_temp.fx('mav_hist')), pg_temp.fx('allowance'),
  '75% allowance history clears the 70% threshold');

-- Rules ---------------------------------------------------------------------

-- Under $20 at Maverik is the allowance; $20 and up is transportation.
INSERT INTO fx VALUES
  ('rule_small', pg_temp.rule('Maverik', 'allowance', 'exact', NULL, 2000)),
  ('rule_big',   pg_temp.rule('MAVERIK', 'transport', 'exact', 2000, NULL));

SELECT is((SELECT match_text FROM category_rules WHERE id = pg_temp.fx('rule_small')), 'maverik',
  'rule match text is stored normalized');

INSERT INTO fx VALUES
  ('mav_1999', pg_temp.txn('Maverik', -1999, '2026-09-22')),
  ('mav_2000', pg_temp.txn('Maverik', -2000, '2026-09-22'));
SELECT pg_temp.suggest(pg_temp.fx('mav_1999'), pg_temp.fx('mav_2000'));

SELECT is(pg_temp.category_of(pg_temp.fx('mav_1999')), pg_temp.fx('allowance'), '$19.99 matches the under-$20 rule');
SELECT is(pg_temp.category_of(pg_temp.fx('mav_2000')), pg_temp.fx('transport'),
  '$20.00 matches the $20-and-up rule (max is exclusive), beating 75% allowance history');
SELECT is(pg_temp.source_of(pg_temp.fx('mav_2000')), 'rule', 'tagged as a rule suggestion');
SELECT is((SELECT category_rule_id FROM transactions WHERE id = pg_temp.fx('mav_2000')), pg_temp.fx('rule_big'),
  'records which rule matched');

-- Re-running refreshes an untouched history suggestion when a rule now applies.
SELECT pg_temp.rule('walmart', 'clothing', 'exact', 4000, NULL);
SELECT pg_temp.rule('costco', 'clothing');
SELECT is(pg_temp.suggest(pg_temp.fx('costco_new'), pg_temp.fx('walmart_new')), 2,
  'a new rule replaces a history suggestion and fills an uncategorized row');
SELECT is(pg_temp.category_of(pg_temp.fx('costco_new')), pg_temp.fx('clothing'), 'history suggestion was replaced');
SELECT is(pg_temp.source_of(pg_temp.fx('costco_new')), 'rule', 'and re-tagged as a rule suggestion');
SELECT is(pg_temp.suggest(pg_temp.fx('costco_new'), pg_temp.fx('walmart_new')), 0,
  're-running with nothing new changes nothing');

-- Specificity: exact beats contains; longer contains beats shorter.
SELECT pg_temp.rule('mav', 'groceries', 'contains');
SELECT pg_temp.rule('maverik s', 'clothing', 'contains');
INSERT INTO fx VALUES ('mav_slc', pg_temp.txn('MAVERIK #9 SLC', -500, '2026-09-23'));
SELECT pg_temp.suggest(pg_temp.fx('mav_slc'), pg_temp.fx('mav_new'));
SELECT is(pg_temp.category_of(pg_temp.fx('mav_slc')), pg_temp.fx('clothing'),
  'the longest matching contains rule wins');
INSERT INTO fx VALUES ('mav_exact', pg_temp.txn('Maverik', -500, '2026-09-23'));
SELECT pg_temp.suggest(pg_temp.fx('mav_exact'));
SELECT is(pg_temp.category_of(pg_temp.fx('mav_exact')), pg_temp.fx('allowance'),
  'an exact rule beats contains rules');

-- An account-scoped rule beats an otherwise equal unscoped one.
SELECT pg_temp.rule('costco', 'transport', 'exact', NULL, NULL, 'outflow', 'savings');
INSERT INTO fx VALUES ('costco_savings', pg_temp.txn('Costco', -500, '2026-09-23', NULL, 'savings'));
SELECT pg_temp.suggest(pg_temp.fx('costco_savings'));
SELECT is(pg_temp.category_of(pg_temp.fx('costco_savings')), pg_temp.fx('transport'),
  'an account-scoped rule outranks an unscoped one');

-- A rule pointing at an archived category is skipped (history applies instead).
SELECT pg_temp.txn('Trader Joe''s', -6000, '2026-09-10', ARRAY['groceries']);
SELECT pg_temp.rule('trader joes', 'archived');
INSERT INTO fx VALUES ('tj_new', pg_temp.txn('TRADER JOE''S #552', -100, '2026-09-23'));
SELECT pg_temp.suggest(pg_temp.fx('tj_new'));
SELECT is(pg_temp.category_of(pg_temp.fx('tj_new')), pg_temp.fx('groceries'),
  'rules for archived categories are skipped in favor of history');

SELECT throws_ok(
  $$SELECT pg_temp.rule('ab', 'groceries', 'contains')$$,
  '23514', NULL, 'contains rules need at least 3 characters');
SELECT throws_ok(
  $$SELECT pg_temp.rule('x', 'groceries', 'exact', 2000, 1000)$$,
  '23514', NULL, 'min must be below max');
SELECT throws_ok(
  format($$INSERT INTO category_rules (plan_id, match_text, category_id) VALUES ('%s', 'kroger', '%s')$$,
    pg_temp.fx('plan_a'), pg_temp.fx('groceries_b')),
  'P0001', 'category rule category does not belong to its plan', 'rules cannot use another plan''s category');

-- Provenance is cleared when the categories change -------------------------

SELECT ledger_replace_allocations(pg_temp.fx('mav_1999'),
  format('[{"category_id":"%s","amount_cents":-1999}]', pg_temp.fx('allowance'))::jsonb);
SELECT is(pg_temp.source_of(pg_temp.fx('mav_1999')), 'rule',
  're-saving the suggested category keeps the suggestion tag');

SELECT ledger_replace_allocations(pg_temp.fx('mav_1999'),
  format('[{"category_id":"%s","amount_cents":-1999}]', pg_temp.fx('groceries'))::jsonb);
SELECT is(pg_temp.source_of(pg_temp.fx('mav_1999')), NULL, 'changing the category clears the tag');
SELECT is(pg_temp.suggest(pg_temp.fx('mav_1999')), 0, 'and the user''s choice is never re-suggested over');

SELECT ledger_update_amount_and_allocations(pg_temp.fx('mav_2000'), -2500,
  format('[{"category_id":"%s","amount_cents":-1500},{"category_id":"%s","amount_cents":-1000}]',
    pg_temp.fx('transport'), pg_temp.fx('allowance'))::jsonb);
SELECT is(pg_temp.source_of(pg_temp.fx('mav_2000')), NULL, 'splitting a suggestion clears the tag');

-- A suggestion follows an amount change made by a later sync.
UPDATE transactions SET amount_cents = -1100 WHERE id = pg_temp.fx('mav_exact');
SELECT pg_temp.suggest(pg_temp.fx('mav_exact'));
SELECT is((SELECT amount_cents FROM transaction_allocations WHERE transaction_id = pg_temp.fx('mav_exact')),
  -1100::bigint, 're-running resizes a suggestion to the new amount');

-- Rule preview -----------------------------------------------------------------

SELECT is(
  (SELECT match_count FROM category_rule_preview(pg_temp.fx('plan_a'), 'exact', 'MAVERIK #1', 'outflow', NULL, 2000, NULL)),
  (SELECT count(*)::int FROM transactions t JOIN accounts a ON a.id = t.account_id
   WHERE a.plan_id = pg_temp.fx('plan_a') AND a.on_budget AND t.transfer_account_id IS NULL
     AND t.payee_key = 'maverik' AND t.amount_cents < 0 AND abs(t.amount_cents) < 2000),
  'preview counts the plan''s matching transactions, normalizing the match text');
SELECT is(
  (SELECT match_count FROM category_rule_preview(pg_temp.fx('plan_a'), 'exact', 'maverik', 'inflow', NULL, NULL, NULL)),
  1, 'preview respects direction');
SELECT ok('MAVERIK #9 SLC' = ANY (p.sample_payees), 'preview lists sample payees a contains rule catches')
FROM category_rule_preview(pg_temp.fx('plan_a'), 'contains', 'maverik s', 'outflow', NULL, NULL, NULL) p;
SELECT is(
  (SELECT match_count FROM category_rule_preview(pg_temp.fx('plan_a'), 'exact', 'kroger', 'outflow', NULL, NULL, NULL)),
  1, 'preview is scoped to the given plan (plan B''s Kroger is excluded)');

-- RLS -------------------------------------------------------------------------

CREATE FUNCTION pg_temp.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(uuid) TO authenticated;

INSERT INTO fx VALUES ('mav_rls', pg_temp.txn('Maverik', -500, '2026-09-24'));

SELECT pg_temp.act_as('20000000-0000-0000-0000-00000000000b');
SELECT is((SELECT count(*) FROM category_rules), 0::bigint, 'another plan''s rules are invisible');
SELECT is(ledger_apply_category_suggestions(ARRAY[pg_temp.fx('mav_rls')]), 0,
  'another plan''s transactions cannot be suggested');
RESET ROLE;

SELECT pg_temp.act_as('20000000-0000-0000-0000-00000000000a');
SELECT is(ledger_apply_category_suggestions(ARRAY[pg_temp.fx('mav_rls')]), 1,
  'a plan member can apply suggestions');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
