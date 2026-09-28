-- A "sinking" target: need the full amount at the start of every cycle
-- (every repeat_interval_months), funded by hand from the shared Sinking Fund
-- category rather than by monthly assignments to the category itself. See
-- SPENDING PLAN WIZARD in docs/budgeting-app-architecture.md.
--
-- Split into its own migration: Postgres forbids using a new enum value
-- inside the same transaction that added it, and the next migration's CHECK
-- constraints reference it.
ALTER TYPE target_type ADD VALUE 'sinking';
