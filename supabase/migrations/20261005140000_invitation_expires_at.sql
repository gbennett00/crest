-- Surface the invitation's expiry on the public acceptance page. The intro RPC
-- previously returned only an `expired` boolean; add the actual `expires_at`
-- timestamp so the page can show the date. Adding a column to the RETURNS TABLE
-- changes the function's signature, which CREATE OR REPLACE can't do, so drop
-- and recreate (re-granting afterwards).

DROP FUNCTION IF EXISTS get_invitation_details(text);

CREATE FUNCTION get_invitation_details(p_token text)
RETURNS TABLE (
  plan_name     text,
  inviter_email text,
  invitee_email text,
  status        text,
  expired       boolean,
  expires_at    timestamptz
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
         (i.expires_at <= now()),
         i.expires_at
  FROM plan_invitations i
  JOIN plans p       ON p.id = i.plan_id
  JOIN auth.users u  ON u.id = i.invited_by
  WHERE i.token = p_token;
$$;

GRANT EXECUTE ON FUNCTION get_invitation_details(text) TO anon, authenticated;
