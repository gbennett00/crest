-- Optional cap on set_aside targets (migration 20261006120000). Run with `supabase test db`.
BEGIN;
SELECT plan(6);

INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('20000000-0000-0000-0000-00000000000a', 'cap-a@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

CREATE TEMP TABLE fx (key text PRIMARY KEY, id uuid);

WITH g AS (
  INSERT INTO category_groups (name, budget_mode, plan_id)
  VALUES ('Health', 'category', (SELECT plan_id FROM plan_members WHERE user_id = '20000000-0000-0000-0000-00000000000a'))
  RETURNING id
) INSERT INTO fx SELECT 'group', id FROM g;
WITH c AS (
  INSERT INTO categories (name, group_id) VALUES ('Medical', (SELECT id FROM fx WHERE key = 'group')) RETURNING id
) INSERT INTO fx SELECT 'medical', id FROM c;

SELECT lives_ok(
  $$INSERT INTO targets (category_id, type, amount_cents, cap_cents)
    VALUES ((SELECT id FROM fx WHERE key = 'medical'), 'set_aside', 15000, 30000)$$,
  'a set_aside target accepts a cap above its amount');

SELECT is((SELECT cap_cents FROM targets WHERE category_id = (SELECT id FROM fx WHERE key = 'medical')),
  30000::bigint, 'the cap is stored as bigint cents');

SELECT lives_ok(
  $$UPDATE targets SET cap_cents = 15000 WHERE category_id = (SELECT id FROM fx WHERE key = 'medical')$$,
  'a cap equal to the amount is allowed');

SELECT throws_ok(
  $$UPDATE targets SET cap_cents = 14999 WHERE category_id = (SELECT id FROM fx WHERE key = 'medical')$$,
  '23514', NULL, 'a cap below the amount is rejected');

SELECT throws_ok(
  $$UPDATE targets SET type = 'fill_up_to' WHERE category_id = (SELECT id FROM fx WHERE key = 'medical')$$,
  '23514', NULL, 'a cap is rejected on any type other than set_aside');

SELECT lives_ok(
  $$UPDATE targets SET cap_cents = NULL, type = 'fill_up_to' WHERE category_id = (SELECT id FROM fx WHERE key = 'medical')$$,
  'clearing the cap lets the type change');

SELECT * FROM finish();
ROLLBACK;
