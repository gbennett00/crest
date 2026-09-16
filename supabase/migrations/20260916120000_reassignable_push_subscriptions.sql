-- A push subscription's `endpoint` is scoped to the browser/device, not the
-- signed-in user, so the same endpoint can outlive a logout/login as a
-- different account (a shared device, or testing multiple accounts in one
-- browser). subscribeToPush's plain `upsert(..., { onConflict: "endpoint" })`
-- hits the own_subscriptions RLS policy (user_id = auth.uid()) on the UPDATE
-- half of that upsert when the existing row belongs to a different user —
-- Postgres can't see the conflicting row to update it, so it reports a
-- duplicate-key error instead of reassigning the row. The client only logs
-- that failure, leaving the browser's own PushManager subscription (which is
-- what the "Push notifications" toggle actually reads) looking enabled while
-- no row exists server-side to send to.
--
-- SECURITY DEFINER so the reassignment can bypass RLS for the *existing* row
-- while still trusting auth.uid() (not a caller-supplied id) for the new
-- owner.
CREATE OR REPLACE FUNCTION upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_key)
  VALUES (auth.uid(), p_endpoint, p_p256dh, p_auth_key)
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        p256dh = EXCLUDED.p256dh,
        auth_key = EXCLUDED.auth_key;
$$;

GRANT EXECUTE ON FUNCTION upsert_push_subscription(text, text, text) TO authenticated;
