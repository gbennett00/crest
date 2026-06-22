-- Multi-user support: a "plan" is a YNAB-style budget workspace. Every piece of
-- data belongs to a plan; authorization is "is the current user a member of the
-- owning plan". Multiple users can collaborate on one plan, and a user may belong
-- to multiple plans (the app assumes one per user for now).
--
-- Ownership lives on two root tables (category_groups, accounts) in the next
-- migration; all other tables are owned transitively via their existing foreign
-- keys. budget_settings is merged into plans (monthly_income_cents column) and
-- dropped in the backfill migration.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  monthly_income_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_members (
  plan_id uuid NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, user_id)
);

CREATE INDEX plan_members_user_id_idx ON plan_members (user_id);

-- ---------------------------------------------------------------------------
-- Access helper
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so it can read plan_members without triggering plan_members'
-- own RLS — this prevents infinite recursion when policies reference the same
-- table. STABLE because membership doesn't change within a statement.
CREATE OR REPLACE FUNCTION user_can_access_plan(p_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM plan_members
    WHERE plan_id = p_plan_id AND user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Per-plan provisioning (replaces the global Ready-to-Assign seed for all
-- future plans — see 20260524120000_initial_schema.sql seed block).
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so the auth.users trigger (and explicit callers) can seed a
-- new plan's rows before any membership exists / regardless of RLS.
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

-- Provision a personal plan whenever a new auth user is created.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM create_plan_for_user(NEW.id, 'My Budget');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS + grants for the new tables
-- ---------------------------------------------------------------------------

ALTER TABLE plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_access" ON plans
  FOR ALL TO authenticated
  USING (user_can_access_plan(id))
  WITH CHECK (user_can_access_plan(id));

CREATE POLICY "members_access" ON plan_members
  FOR ALL TO authenticated
  USING (user_can_access_plan(plan_id))
  WITH CHECK (user_can_access_plan(plan_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON plans        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_members TO authenticated;

GRANT EXECUTE ON FUNCTION user_can_access_plan(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION create_plan_for_user(uuid, text)  TO authenticated;
