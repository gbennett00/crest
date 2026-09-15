-- Historical per-account balance, one row per (account, month with any
-- activity) — the running total *as of the end of that month*. Backs the
-- Reports net worth trend: a month with no activity simply isn't a row, and
-- callers carry the previous row's balance forward.
--
-- Computed as a cumulative SUM via a window function rather than pulling raw
-- transactions into application code and summing there — an account with a
-- long history can have far more than the PostgREST default row cap (1000)
-- in transactions, but nowhere near that many distinct active months. Same
-- reasoning as account_balances (20260818120000).
--
-- security_invoker so the querying user's RLS on `transactions` still applies.
CREATE VIEW account_monthly_balance
WITH (security_invoker = true)
AS
SELECT
  account_id,
  month,
  SUM(month_activity_cents) OVER (
    PARTITION BY account_id ORDER BY month
  )::bigint AS balance_cents
FROM (
  SELECT
    account_id,
    budget_month(txn_date) AS month,
    SUM(amount_cents) AS month_activity_cents
  FROM transactions
  GROUP BY account_id, budget_month(txn_date)
) monthly;

GRANT SELECT ON account_monthly_balance TO authenticated;
