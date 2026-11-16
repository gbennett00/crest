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
  -- When a PENDING_DISCONNECT / PENDING_EXPIRATION webhook warned that access
  -- ends in ~7 days. Plaid sends it once, so it lives apart from `status`:
  -- error updates and LOGIN_REPAIRED must not erase it. Cleared by a repair, or
  -- when /item/get shows consent renewed well into the future.
  ADD COLUMN disconnect_warned_at    timestamptz,
  -- When /item/get was last called for this Item. NULL = never checked, so the
  -- staleness rule has nothing to go on yet.
  ADD COLUMN status_checked_at       timestamptz;

-- The old webhook handler stored PENDING_EXPIRATION as status 'login_required'.
-- That was a warning (the Item still worked), not a login error: move it to
-- disconnect_warned_at and put the Item back to 'good'.
UPDATE plaid_items
  SET disconnect_warned_at = updated_at, status = 'good'
  WHERE status = 'login_required';
UPDATE plaid_items SET status = 'error' WHERE status NOT IN ('good', 'error', 'revoked');

ALTER TABLE plaid_items
  ADD CONSTRAINT plaid_items_status_check
  CHECK (status IN ('good', 'error', 'revoked'));
