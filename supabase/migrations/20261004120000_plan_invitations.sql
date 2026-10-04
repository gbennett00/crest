-- Multi-person plans: let a plan's creator invite other people to collaborate.
--
-- Rules for this iteration:
--   * Only the plan's creator (the 'owner' member) may invite or remove people.
--   * Invitations are addressed to an email, carry an opaque token used in the
--     invite link, and expire one week after they are created.
--   * A logged-out / not-yet-registered invitee can see the invitation's intro
--     details (who invited them, to which plan) via a SECURITY DEFINER lookup,
--     then sign in / sign up and accept it.
--
-- Membership already exists (plan_members, role 'owner' | 'member'); the creator
-- is provisioned as 'owner' by create_plan_for_user(). This migration adds the
-- invitations table, an owner predicate, an accept RPC, and read helpers that
-- expose auth.users emails to members without opening up the auth schema.

-- ---------------------------------------------------------------------------
-- Owner predicate (mirrors user_can_access_plan; SECURITY DEFINER so it can
-- read plan_members without recursing into that table's own RLS).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION user_is_plan_owner(p_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM plan_members
    WHERE plan_id = p_plan_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Invitations table
-- ---------------------------------------------------------------------------

CREATE TABLE plan_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  email       text NOT NULL,
  token       text NOT NULL UNIQUE,
  invited_by  uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT plan_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'revoked'))
);

CREATE INDEX plan_invitations_plan_id_idx ON plan_invitations (plan_id);
CREATE INDEX plan_invitations_email_idx   ON plan_invitations (lower(email));

-- At most one live (pending) invitation per plan + email. The invite action
-- clears any prior pending row for the address before inserting, so re-inviting
-- (e.g. after expiry) refreshes the token and clock rather than colliding.
CREATE UNIQUE INDEX plan_invitations_one_pending_per_email
  ON plan_invitations (plan_id, lower(email))
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Accept flow (SECURITY DEFINER: the invitee is not yet a plan member, so RLS
-- would otherwise hide the invitation and block the plan_members insert).
-- ---------------------------------------------------------------------------

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

  UPDATE plan_invitations
  SET status = 'accepted', accepted_at = now(), accepted_by = auth.uid()
  WHERE id = v_inv.id;

  RETURN v_inv.plan_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Read helpers exposing auth.users emails (SECURITY DEFINER, tightly scoped).
-- ---------------------------------------------------------------------------

-- Intro details for an invitation, keyed only by its token. Callable by anon so
-- a logged-out invitee can see who invited them before authenticating. Returns
-- only the plan name, inviter/invitee email, status and an expired flag.
CREATE OR REPLACE FUNCTION get_invitation_details(p_token text)
RETURNS TABLE (
  plan_name     text,
  inviter_email text,
  invitee_email text,
  status        text,
  expired       boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.name,
         u.email::text,
         i.email,
         i.status,
         (i.expires_at <= now())
  FROM plan_invitations i
  JOIN plans p       ON p.id = i.plan_id
  JOIN auth.users u  ON u.id = i.invited_by
  WHERE i.token = p_token;
$$;

-- Members of a plan with their email. Guarded so only a member of the plan gets
-- rows back; a non-member receives an empty set.
CREATE OR REPLACE FUNCTION plan_members_with_email(p_plan_id uuid)
RETURNS TABLE (
  user_id    uuid,
  email      text,
  role       text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.user_id, u.email::text, m.role, m.created_at
  FROM plan_members m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.plan_id = p_plan_id
    AND user_can_access_plan(p_plan_id)
  ORDER BY (m.role = 'owner') DESC, m.created_at;
$$;

-- Plans the current user belongs to, with their role. Used by the plan switcher.
CREATE OR REPLACE FUNCTION my_plans()
RETURNS TABLE (
  plan_id    uuid,
  name       text,
  role       text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.plan_id, p.name, m.role, m.created_at
  FROM plan_members m
  JOIN plans p ON p.id = m.plan_id
  WHERE m.user_id = auth.uid()
  ORDER BY m.created_at;
$$;

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

ALTER TABLE plan_invitations ENABLE ROW LEVEL SECURITY;

-- Only a plan's owner can see or manage its invitations.
CREATE POLICY "owner_manage" ON plan_invitations
  FOR ALL TO authenticated
  USING (user_is_plan_owner(plan_id))
  WITH CHECK (user_is_plan_owner(plan_id));

-- Tighten plan_members: previously any member could mutate any membership row.
-- Now members may read the roster, but only the owner may remove people (and
-- never the owner row itself). Inserts still happen through SECURITY DEFINER
-- functions (create_plan_for_user, accept_plan_invitation), so no direct
-- authenticated INSERT policy is needed.
DROP POLICY "members_access" ON plan_members;

CREATE POLICY "members_select" ON plan_members
  FOR SELECT TO authenticated
  USING (user_can_access_plan(plan_id));

CREATE POLICY "owner_remove_members" ON plan_members
  FOR DELETE TO authenticated
  USING (user_is_plan_owner(plan_id) AND role <> 'owner');

GRANT SELECT, INSERT, UPDATE, DELETE ON plan_invitations TO authenticated;

GRANT EXECUTE ON FUNCTION user_is_plan_owner(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION accept_plan_invitation(text)    TO authenticated;
GRANT EXECUTE ON FUNCTION get_invitation_details(text)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION plan_members_with_email(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION my_plans()                      TO authenticated;
