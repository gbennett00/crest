-- Read-only SQL helpers for budget math (computed at query time — not stored).
-- Canonical business logic + unit tests should live in application code (e.g. lib/budget/).
-- Use security_invoker so RLS on base tables applies when you add it later.

CREATE OR REPLACE FUNCTION budget_month(d date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT date_trunc('month', d)::date;
$$;

-- Sum of split amounts per category per calendar month (approved ledger only).
CREATE VIEW category_monthly_activity
WITH (security_invoker = true)
AS
SELECT
  ta.category_id,
  budget_month(t.txn_date) AS month,
  COALESCE(SUM(ta.amount_cents), 0)::bigint AS activity_cents
FROM transaction_allocations ta
INNER JOIN transactions t ON t.id = ta.transaction_id
WHERE t.approved_at IS NOT NULL
GROUP BY ta.category_id, budget_month(t.txn_date);

-- Direct category assignments (group-mode pools use monthly_budgets.group_id instead).
CREATE VIEW category_monthly_assigned
WITH (security_invoker = true)
AS
SELECT
  category_id,
  month,
  assigned_cents
FROM monthly_budgets
WHERE category_id IS NOT NULL;

-- ready_to_assign = sum(account balances) - sum(all assignments through as_of_month)
CREATE OR REPLACE FUNCTION ready_to_assign_cents(as_of_month date)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT
    (SELECT COALESCE(SUM(balance_cents), 0) FROM accounts WHERE is_active)
    - (
      SELECT COALESCE(SUM(assigned_cents), 0)
      FROM monthly_budgets
      WHERE month <= as_of_month
    );
$$;
