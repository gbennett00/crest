-- Connection health for Plaid Items.
--
-- Two different problems look the same from the transaction list ("nothing new
-- has come in"), and the UI must tell them apart:
--
--   * needs repair — the Item is in an error state (ITEM_LOGIN_REQUIRED, consent
--     about to expire, permission revoked). Only the user can fix it, through
--     Link update mode.
--   * delayed — the Item is healthy but Plaid hasn't managed to reach the bank
--     recently. It resolves on its own.
--
-- A quiet account with a healthy connection is neither: Plaid's
-- status.transactions.last_successful_update moves on every successful check
-- "regardless of whether any new data is available", so a recent value with
-- no new transactions just means nothing happened. These columns cache the
-- /item/get fields that drive that decision; the health state itself is
-- derived in code (lib/plaid/connection-health.ts), never stored.

ALTER TABLE plaid_items
  ADD COLUMN last_successful_update  timestamptz,
  ADD COLUMN last_failed_update      timestamptz,
  ADD COLUMN consent_expiration_time timestamptz,
  -- When /item/get was last called for this Item. NULL = never checked, so the
  -- staleness rule has nothing to go on yet.
  ADD COLUMN status_checked_at       timestamptz;

-- The old webhook handler stored PENDING_EXPIRATION as 'login_required'. It is
-- a warning that access is about to end (the Item still works), not a login
-- error, so give it its own value alongside PENDING_DISCONNECT.
UPDATE plaid_items SET status = 'pending_disconnect' WHERE status = 'login_required';
UPDATE plaid_items SET status = 'error' WHERE status NOT IN ('good', 'error', 'pending_disconnect', 'revoked');

ALTER TABLE plaid_items
  ADD CONSTRAINT plaid_items_status_check
  CHECK (status IN ('good', 'error', 'pending_disconnect', 'revoked'));
