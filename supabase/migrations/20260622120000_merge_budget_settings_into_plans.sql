-- Merge budget_settings into plans. budget_settings was a 1:1 table with plans
-- containing only monthly_income_cents (unused in app code). Consolidating
-- removes a table, its RLS policy, and a provisioning step.

-- ---------------------------------------------------------------------------
-- 1. Add the column to plans and copy existing values
-- ---------------------------------------------------------------------------

ALTER TABLE plans ADD COLUMN monthly_income_cents bigint NOT NULL DEFAULT 0;

UPDATE plans p
SET monthly_income_cents = bs.monthly_income_cents
FROM budget_settings bs
WHERE bs.plan_id = p.id;

-- ---------------------------------------------------------------------------
-- 2. Drop budget_settings (CASCADE removes its RLS policies, indexes, etc.)
-- ---------------------------------------------------------------------------

DROP TABLE budget_settings CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Revoke the now-stale grant (DROP TABLE CASCADE handles policies but not
--    external grants — however since the table is gone the grant is moot;
--    included here for documentation).
-- ---------------------------------------------------------------------------

-- GRANT on budget_settings is automatically invalidated by DROP TABLE.

-- ---------------------------------------------------------------------------
-- 4. Update create_plan_for_user to remove the budget_settings INSERT
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_plan_for_user(p_user_id uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
  v_group_id uuid;
BEGIN
  INSERT INTO plans (name) VALUES (p_name) RETURNING id INTO v_plan_id;

  INSERT INTO plan_members (plan_id, user_id, role)
  VALUES (v_plan_id, p_user_id, 'owner');

  INSERT INTO category_groups (name, budget_mode, is_pinned, plan_id)
  VALUES ('Budget', 'category', true, v_plan_id)
  RETURNING id INTO v_group_id;

  INSERT INTO categories (name, group_id, is_pinned, role)
  VALUES ('Ready to Assign', v_group_id, true, 'ready_to_assign'::category_role);

  RETURN v_plan_id;
END;
$$;
