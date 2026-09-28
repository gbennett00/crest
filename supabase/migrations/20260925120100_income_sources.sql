-- Income sources for the Spending Plan builder: a simple name + monthly
-- amount per source, purely informational (never feeds Ready to Assign or any
-- ledger math — RTA stays derived from categorized ledger inflows only, per
-- docs/budgeting-app-architecture.md). Scoped to the plan/workspace, not to
-- any one spending-plan "run", since income doesn't change month to month.
--
-- `plans.monthly_income_cents` was a single dormant column for the same idea
-- (never read or written anywhere in application code) — dropped in favor of
-- summing this table on read (lib/budget/compute.ts computePlannedIncomeCents),
-- consistent with "derived values are never stored".

CREATE TABLE income_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  name text NOT NULL,
  monthly_amount_cents bigint NOT NULL,
  sort_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_income_sources_plan_id ON income_sources (plan_id);

ALTER TABLE income_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_access" ON income_sources
  FOR ALL TO authenticated
  USING (user_can_access_plan(plan_id))
  WITH CHECK (user_can_access_plan(plan_id));

ALTER TABLE plans DROP COLUMN monthly_income_cents;
