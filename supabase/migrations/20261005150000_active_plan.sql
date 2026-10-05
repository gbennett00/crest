-- One active plan per user.
--
-- Every user gets a personal plan at signup, and accepting an invitation adds a
-- second membership. RLS previously granted access to *every* plan a user
-- belongs to, but the app's reads (budget loader, reports, registers, ...) are
-- unscoped and assume a single plan. An invitee therefore saw their personal
-- plan's rows merged with the shared plan's: two Ready to Assign categories,
-- summed assignments and activity, and a wildly wrong Ready to Assign figure.
--
-- Fix at the source: RLS now exposes only the user's *active* plan. Every table
-- policy goes through user_can_access_plan() / user_plan_ids(), so redefining
-- those two narrows all reads and writes at once — and getActivePlanId() (an
-- unordered plan_members lookup) becomes deterministic as a side effect.
--
-- The active plan is the one the user last selected (set_active_plan, or
-- implicitly by accepting an invitation). With no selection, or if the selected
-- membership has since been removed, it falls back to the user's oldest
-- membership — their personal plan — so single-plan users are unaffected.
-- Switching plans is a separate UI concern; my_plans() already lists them.

CREATE TABLE user_active_plan (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans (id) ON DELETE CASCADE
);

-- Written only through the SECURITY DEFINER functions below.
ALTER TABLE user_active_plan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_active_plan FROM anon, authenticated;

-- The caller's active plan id, or null when they belong to no plan.
CREATE FUNCTION user_active_plan_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.plan_id
  FROM plan_members m
  LEFT JOIN user_active_plan a
    ON a.user_id = m.user_id AND a.plan_id = m.plan_id
  WHERE m.user_id = auth.uid()
  ORDER BY (a.plan_id IS NOT NULL) DESC, m.created_at, m.plan_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION user_active_plan_id() TO authenticated;

-- Same signature as before, so every existing policy picks this up unchanged.
CREATE OR REPLACE FUNCTION user_can_access_plan(p_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_plan_id IS NOT NULL AND p_plan_id = user_active_plan_id();
$$;

-- budget_moves' policies compare plan_id against this array.
CREATE OR REPLACE FUNCTION user_plan_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id FROM (SELECT user_active_plan_id() AS id) p WHERE p.id IS NOT NULL;
$$;

-- Switch the caller's active plan (must be one they belong to).
CREATE FUNCTION set_active_plan(p_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM plan_members WHERE plan_id = p_plan_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not_a_member';
  END IF;

  INSERT INTO user_active_plan (user_id, plan_id)
  VALUES (auth.uid(), p_plan_id)
  ON CONFLICT (user_id) DO UPDATE SET plan_id = EXCLUDED.plan_id;
END;
$$;

GRANT EXECUTE ON FUNCTION set_active_plan(uuid) TO authenticated;

-- Accepting an invitation switches the invitee into the plan they just joined
-- (otherwise they'd land back in their empty personal plan). Same as
-- 20261004120000 plus the user_active_plan upsert.
CREATE OR REPLACE FUNCTION accept_plan_invitation(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv   plan_invitations%ROWTYPE;
  v_email text := auth.jwt() ->> 'email';
BEGIN
  IF auth.uid() IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_inv FROM plan_invitations WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found';
  END IF;
  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'invitation_not_pending';
  END IF;
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation_expired';
  END IF;
  IF lower(v_inv.email) <> lower(v_email) THEN
    RAISE EXCEPTION 'invitation_email_mismatch';
  END IF;

  INSERT INTO plan_members (plan_id, user_id, role)
  VALUES (v_inv.plan_id, auth.uid(), 'member')
  ON CONFLICT (plan_id, user_id) DO NOTHING;

  INSERT INTO user_active_plan (user_id, plan_id)
  VALUES (auth.uid(), v_inv.plan_id)
  ON CONFLICT (user_id) DO UPDATE SET plan_id = EXCLUDED.plan_id;

  UPDATE plan_invitations
  SET status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  WHERE id = v_inv.id;

  RETURN v_inv.plan_id;
END;
$$;
