-- Plaid accounts the user chose NOT to track in Crest during linking (e.g.
-- sandbox or secondary accounts an Item returns that don't belong in the budget).
--
-- syncItem skips both account creation and transaction import for these Plaid
-- account ids. Persisting the decision here (rather than only honoring it during
-- the initial link) means later manual "Sync now" and webhook-triggered syncs
-- don't silently recreate an account the user deliberately left out.
ALTER TABLE plaid_items
  ADD COLUMN ignored_account_ids text[] NOT NULL DEFAULT '{}';
