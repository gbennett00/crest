-- Invariants captured before and after pending migrations are applied to a
-- copy of production data (scripts/rehearse-migrations.sh). Every row is
-- "<check name>|<values>"; the rehearsal fails if any check's rows differ.
-- Migrations shouldn't change money math, so these should never move. If a
-- migration intentionally changes one, update the query (it must run against
-- both the old and the new schema) in the same PR.

-- Assigned totals per budget month and funding unit.
SELECT 'assigned|' || month || '|' || COALESCE(category_id, group_id) || '|' || assigned_cents
FROM monthly_budgets
WHERE assigned_cents <> 0;

-- Category activity per month.
SELECT 'activity|' || month || '|' || category_id || '|' || activity_cents
FROM category_monthly_activity
WHERE activity_cents <> 0;

-- Row counts of the ledger and budget structure.
SELECT 'count|transactions|' || count(*) FROM transactions;
SELECT 'count|transaction_allocations|' || count(*) FROM transaction_allocations;
SELECT 'count|accounts|' || count(*) FROM accounts;
SELECT 'count|category_groups|' || count(*) FROM category_groups;
SELECT 'count|categories|' || count(*) FROM categories;
SELECT 'count|targets|' || count(*) FROM targets;
