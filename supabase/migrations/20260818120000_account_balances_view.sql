-- Per-account balance read model. Registers previously fetched every
-- transaction row and summed amount_cents in application code, which is both
-- wasteful and — because the PostgREST Data API caps responses at max_rows
-- (1000) — silently wrong for any account with more than 1000 transactions.
-- Aggregating inside Postgres returns one row per account, immune to that cap.
--
-- Sign convention matches the ledger: negative = outflow, positive = inflow.
--   cleared_cents   = sum of cleared lines      (cleared_at IS NOT NULL)
--   uncleared_cents = sum of pending lines      (cleared_at IS NULL)
--   working_cents   = every line, regardless of bank workflow state
-- These mirror sumClearedTransactionAmounts / sumPendingTransactionAmounts /
-- workingBalanceCents in lib/ledger/balance.ts.
--
-- security_invoker so the querying user's RLS on `transactions` still applies,
-- exactly as it did when the rows were fetched directly.
CREATE VIEW account_balances
WITH (security_invoker = true)
AS
SELECT
  account_id,
  COALESCE(SUM(amount_cents) FILTER (WHERE cleared_at IS NOT NULL), 0)::bigint AS cleared_cents,
  COALESCE(SUM(amount_cents) FILTER (WHERE cleared_at IS NULL),     0)::bigint AS uncleared_cents,
  COALESCE(SUM(amount_cents),                                        0)::bigint AS working_cents
FROM transactions
GROUP BY account_id;

GRANT SELECT ON account_balances TO authenticated;
