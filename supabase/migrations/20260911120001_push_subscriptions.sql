-- Web Push subscriptions, one row per browser/device a user has enabled
-- notifications on. Keyed by user (not plan) since notification delivery is
-- per-device; fan-out to a whole plan is done by joining through plan_members.

CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth_key   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users manage only their own subscriptions. The Plaid webhook reads across
-- users (to notify every member of a plan) using the service-role key, which
-- bypasses RLS automatically — no separate policy needed for that.
CREATE POLICY "own_subscriptions" ON push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
