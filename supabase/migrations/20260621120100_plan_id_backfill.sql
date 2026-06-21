-- Add plan ownership to the three root tables, backfill the existing single-user
-- data into one default plan, then make the columns NOT NULL — all atomic in this
-- one migration (Supabase runs each file in a transaction). A two-step nullable→
-- backfill→NOT-NULL deploy is only needed for zero-downtime on large tables.

ALTER TABLE category_groups
  ADD COLUMN plan_id uuid REFERENCES plans (id) ON DELETE CASCADE;
ALTER TABLE accounts
  ADD COLUMN plan_id uuid REFERENCES plans (id) ON DELETE CASCADE;
ALTER TABLE budget_settings
  ADD COLUMN plan_id uuid REFERENCES plans (id) ON DELETE CASCADE;

-- Backfill: create one plan for the pre-existing user and assign all current rows.
DO $$
DECLARE
  v_plan uuid;
  v_user uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;

  INSERT INTO plans (name) VALUES ('My Budget') RETURNING id INTO v_plan;

  IF v_user IS NOT NULL THEN
    INSERT INTO plan_members (plan_id, user_id, role)
    VALUES (v_plan, v_user, 'owner');
  END IF;

  UPDATE category_groups SET plan_id = v_plan WHERE plan_id IS NULL;
  UPDATE accounts        SET plan_id = v_plan WHERE plan_id IS NULL;
  UPDATE budget_settings SET plan_id = v_plan WHERE plan_id IS NULL;

  -- If there were no budget_settings yet, seed one for the default plan.
  IF NOT EXISTS (SELECT 1 FROM budget_settings WHERE plan_id = v_plan) THEN
    INSERT INTO budget_settings (plan_id) VALUES (v_plan);
  END IF;
END $$;

ALTER TABLE category_groups ALTER COLUMN plan_id SET NOT NULL;
ALTER TABLE accounts        ALTER COLUMN plan_id SET NOT NULL;
ALTER TABLE budget_settings ALTER COLUMN plan_id SET NOT NULL;

CREATE INDEX category_groups_plan_id_idx ON category_groups (plan_id);
CREATE INDEX accounts_plan_id_idx        ON accounts (plan_id);

-- Ready to Assign is now per-plan. Each plan has exactly one "Budget" group
-- (via create_plan_for_user), so "one RTA per group" yields one RTA per plan.
DROP INDEX categories_role_ready_to_assign_unique;
CREATE UNIQUE INDEX categories_group_ready_to_assign_unique
  ON categories (group_id)
  WHERE role = 'ready_to_assign';

-- One settings row per plan.
ALTER TABLE budget_settings
  ADD CONSTRAINT budget_settings_plan_id_unique UNIQUE (plan_id);
