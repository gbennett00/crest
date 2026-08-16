-- PostgREST caches the database schema (including function signatures) and
-- doesn't always pick up DDL changes from `supabase db push` promptly on its
-- own — the last few migrations (ledger_create_transfer's new signature,
-- ledger_bulk_upsert_transactions, ledger_bulk_upsert_category_budgets) 404'd
-- against production immediately after deploying because of this. Explicitly
-- notify PostgREST so it reloads right away rather than waiting on its own
-- polling/retry.
NOTIFY pgrst, 'reload schema';
