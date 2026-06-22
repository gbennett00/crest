-- Add plan ownership to the two root tables, backfill the existing single-user
-- data into one default plan, absorb budget_settings into plans, then make the
-- columns NOT NULL — all atomic in this one migration (Supabase runs each file
-- in a transaction).

ALTER TABLE category_groups
  ADD COLUMN plan_id uuid REFERENCES plans (id) ON DELETE CASCADE;
ALTER TABLE accounts
  ADD COLUMN plan_id uuid REFERENCES plans (id) ON DELETE CASCADE;

-- Backfill: create one plan for the pre-existing user and assign all current rows.
DO $$
DECLARE
  v_plan uuid;
  v_user uuid;
  v_income bigint;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;

  INSERT INTO plans (name) VALUES ('My Budget') RETURNING id INTO v_plan;

  IF v_user IS NOT NULL THEN
    INSERT INTO plan_members (plan_id, user_id, role)
    VALUES (v_plan, v_user, 'owner');
  END IF;

  UPDATE category_groups SET plan_id = v_plan WHERE plan_id IS NULL;
  UPDATE accounts        SET plan_id = v_plan WHERE plan_id IS NULL;

  -- Copy monthly_income_cents from budget_settings into the new plan row.
  SELECT monthly_income_cents INTO v_income
  FROM budget_settings
  ORDER BY created_at
  LIMIT 1;

  IF v_income IS NOT NULL THEN
    UPDATE plans SET monthly_income_cents = v_income WHERE id = v_plan;
  END IF;
END $$;

ALTER TABLE category_groups ALTER COLUMN plan_id SET NOT NULL;
ALTER TABLE accounts        ALTER COLUMN plan_id SET NOT NULL;

CREATE INDEX category_groups_plan_id_idx ON category_groups (plan_id);
CREATE INDEX accounts_plan_id_idx        ON accounts (plan_id);

-- Ready to Assign is now per-plan. Each plan has exactly one "Budget" group
-- (via create_plan_for_user), so "one RTA per group" yields one RTA per plan.
DROP INDEX categories_role_ready_to_assign_unique;
CREATE UNIQUE INDEX categories_group_ready_to_assign_unique
  ON categories (group_id)
  WHERE role = 'ready_to_assign';

-- budget_settings is now fully absorbed into plans; drop it.
DROP TABLE budget_settings CASCADE;
