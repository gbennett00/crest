-- Group-level budget read models (mirrors category_monthly_activity/assigned).
-- Group activity = sum of all category activity within the group (spending still
-- tracked per category even when the group uses budget_mode = 'group').
-- Group assignments come from monthly_budgets.group_id rows.

CREATE VIEW group_monthly_activity
WITH (security_invoker = true)
AS
SELECT
  c.group_id,
  budget_month(t.txn_date) AS month,
  COALESCE(SUM(ta.amount_cents), 0)::bigint AS activity_cents
FROM transaction_allocations ta
INNER JOIN transactions t ON t.id = ta.transaction_id
INNER JOIN categories c ON c.id = ta.category_id
WHERE t.approved_at IS NOT NULL
GROUP BY c.group_id, budget_month(t.txn_date);

CREATE VIEW group_monthly_assigned
WITH (security_invoker = true)
AS
SELECT
  group_id,
  month,
  assigned_cents
FROM monthly_budgets
WHERE group_id IS NOT NULL;
