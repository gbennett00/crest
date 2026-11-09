-- Snoozed month on categories and groups (migration 20261101120000). Run with `supabase test db`.
BEGIN;
SELECT plan(6);

INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('30000000-0000-0000-0000-00000000000a', 'snooze-a@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

CREATE TEMP TABLE fx (key text PRIMARY KEY, id uuid);

WITH g AS (
  INSERT INTO category_groups (name, budget_mode, plan_id)
  VALUES ('Health', 'category', (SELECT plan_id FROM plan_members WHERE user_id = '30000000-0000-0000-0000-00000000000a'))
  RETURNING id
) INSERT INTO fx SELECT 'group', id FROM g;
WITH c AS (
  INSERT INTO categories (name, group_id) VALUES ('Medical', (SELECT id FROM fx WHERE key = 'group')) RETURNING id
) INSERT INTO fx SELECT 'medical', id FROM c;

SELECT is((SELECT snoozed_month FROM categories WHERE id = (SELECT id FROM fx WHERE key = 'medical')),
  NULL, 'categories are not snoozed by default');

SELECT lives_ok(
  $$UPDATE categories SET snoozed_month = '2026-11-01' WHERE id = (SELECT id FROM fx WHERE key = 'medical')$$,
  'a category can be snoozed for a first-of-month date');

SELECT throws_ok(
  $$UPDATE categories SET snoozed_month = '2026-11-15' WHERE id = (SELECT id FROM fx WHERE key = 'medical')$$,
  '23514', NULL, 'a category snooze must be the first of a month');

SELECT lives_ok(
  $$UPDATE category_groups SET snoozed_month = '2026-11-01' WHERE id = (SELECT id FROM fx WHERE key = 'group')$$,
  'a group can be snoozed for a first-of-month date');

SELECT throws_ok(
  $$UPDATE category_groups SET snoozed_month = '2026-11-02' WHERE id = (SELECT id FROM fx WHERE key = 'group')$$,
  '23514', NULL, 'a group snooze must be the first of a month');

SELECT lives_ok(
  $$UPDATE categories SET snoozed_month = NULL WHERE id = (SELECT id FROM fx WHERE key = 'medical')$$,
  'a snooze can be cleared');

SELECT * FROM finish();
ROLLBACK;
