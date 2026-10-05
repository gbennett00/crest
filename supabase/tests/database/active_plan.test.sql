-- Active plan scoping (migration 20261005120000). Run with `supabase test db`.
--
-- Regression: a user who belongs to two plans (their personal plan + one they
-- joined by invitation) must only see ONE plan's rows, otherwise the budget
-- screen merges both plans' categories/assignments and Ready to Assign is wrong.
BEGIN;
SELECT plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures: owner (a) and invitee (b), each with a personal plan
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('20000000-0000-0000-0000-00000000000a', 'owner@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('20000000-0000-0000-0000-00000000000b', 'invitee@test.dev', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

CREATE TEMP TABLE fx (key text PRIMARY KEY, id uuid);
GRANT SELECT ON fx TO authenticated;

INSERT INTO fx
SELECT 'plan_a', plan_id FROM plan_members WHERE user_id = '20000000-0000-0000-0000-00000000000a'
UNION ALL
SELECT 'plan_b', plan_id FROM plan_members WHERE user_id = '20000000-0000-0000-0000-00000000000b';

CREATE FUNCTION pg_temp.fx(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM fx WHERE key = k $$;

-- Give the shared plan a spending group so the two plans are distinguishable.
INSERT INTO category_groups (name, budget_mode, plan_id)
VALUES ('Shared Bills', 'category', pg_temp.fx('plan_a'));

INSERT INTO plan_invitations (plan_id, email, token, invited_by)
VALUES (pg_temp.fx('plan_a'), 'invitee@test.dev', 'tok-active-plan',
        '20000000-0000-0000-0000-00000000000a');

CREATE FUNCTION pg_temp.act_as(p_user uuid, p_email text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'email', p_email)::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

-- ---------------------------------------------------------------------------
-- Before joining: one plan, one Ready to Assign
-- ---------------------------------------------------------------------------

SELECT pg_temp.act_as('20000000-0000-0000-0000-00000000000b', 'invitee@test.dev');

SELECT is((SELECT user_active_plan_id()), pg_temp.fx('plan_b'),
  'before joining, the active plan is the personal plan');

-- ---------------------------------------------------------------------------
-- After accepting: only the joined plan is visible
-- ---------------------------------------------------------------------------

SELECT is((SELECT accept_plan_invitation('tok-active-plan')), pg_temp.fx('plan_a'),
  'invitation accepted');

SELECT is((SELECT user_active_plan_id()), pg_temp.fx('plan_a'),
  'accepting an invitation switches the active plan to the joined plan');

SELECT results_eq(
  $$SELECT DISTINCT plan_id FROM category_groups$$,
  format($$VALUES ('%s'::uuid)$$, pg_temp.fx('plan_a')),
  'category groups visible from the active plan only');

SELECT is(
  (SELECT count(*) FROM categories WHERE role = 'ready_to_assign'), 1::bigint,
  'exactly one Ready to Assign category is visible (was two before the fix)');

SELECT results_eq(
  $$SELECT DISTINCT plan_id FROM plan_members$$,
  format($$VALUES ('%s'::uuid)$$, pg_temp.fx('plan_a')),
  'plan_members (and so getActivePlanId) resolves to the active plan only');

SELECT is((SELECT count(*) FROM plans), 1::bigint, 'only the active plan row is visible');

SELECT throws_ok(
  format($$INSERT INTO category_groups (name, budget_mode, plan_id) VALUES ('Sneaky', 'category', '%s')$$,
    pg_temp.fx('plan_b')),
  '42501', NULL,
  'cannot write into a non-active plan');

SELECT is((SELECT count(*) FROM my_plans()), 2::bigint,
  'my_plans() still lists every membership for a switcher');

-- ---------------------------------------------------------------------------
-- Switching
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  format($$SELECT set_active_plan('%s')$$, pg_temp.fx('plan_b')),
  'switch back to the personal plan');

SELECT results_eq(
  $$SELECT DISTINCT plan_id FROM category_groups$$,
  format($$VALUES ('%s'::uuid)$$, pg_temp.fx('plan_b')),
  'after switching, only the personal plan is visible');

SELECT throws_ok(
  format($$SELECT set_active_plan('%s')$$, gen_random_uuid()),
  'P0001', 'not_a_member',
  'cannot activate a plan the user does not belong to');

SELECT lives_ok(
  format($$SELECT set_active_plan('%s')$$, pg_temp.fx('plan_a')),
  'switch to the shared plan again');

-- ---------------------------------------------------------------------------
-- Direct access to the pointer table is closed
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$SELECT * FROM user_active_plan$$, '42501', NULL,
  'user_active_plan is not directly readable');

-- ---------------------------------------------------------------------------
-- The owner is unaffected
-- ---------------------------------------------------------------------------

SELECT pg_temp.act_as('20000000-0000-0000-0000-00000000000a', 'owner@test.dev');

SELECT is((SELECT user_active_plan_id()), pg_temp.fx('plan_a'), 'owner stays on their plan');
SELECT is((SELECT count(*) FROM plan_members), 2::bigint, 'owner sees both members of their plan');
SELECT is((SELECT count(*) FROM categories WHERE role = 'ready_to_assign'), 1::bigint,
  'owner sees one Ready to Assign');

-- ---------------------------------------------------------------------------
-- Removing the member falls back to their personal plan
-- ---------------------------------------------------------------------------

RESET ROLE;
DELETE FROM plan_members
WHERE plan_id = pg_temp.fx('plan_a') AND user_id = '20000000-0000-0000-0000-00000000000b';

SELECT pg_temp.act_as('20000000-0000-0000-0000-00000000000b', 'invitee@test.dev');

SELECT is((SELECT user_active_plan_id()), pg_temp.fx('plan_b'),
  'a stale active-plan pointer falls back to the personal plan');

SELECT is((SELECT count(*) FROM category_groups WHERE plan_id = pg_temp.fx('plan_a')), 0::bigint,
  'a removed member sees nothing of the old plan');

SELECT * FROM finish();
ROLLBACK;
