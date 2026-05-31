-- Grant the authenticated role table-level access so PostgREST (Data API)
-- can actually reach the tables.  RLS policies (migration 004) control which
-- rows are visible; these GRANTs control whether the role can even attempt
-- the query.  Without both, you get "permission denied" before RLS fires.

GRANT USAGE ON SCHEMA public TO authenticated;

-- Core tables
GRANT SELECT, INSERT, UPDATE, DELETE ON category_groups         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON categories               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON accounts                 TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON transactions             TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON transaction_allocations  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON monthly_budgets          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON targets                  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON budget_settings          TO authenticated;

-- Read-only views used by budget calculations
GRANT SELECT ON category_monthly_activity  TO authenticated;
GRANT SELECT ON category_monthly_assigned  TO authenticated;
GRANT SELECT ON group_monthly_activity     TO authenticated;
GRANT SELECT ON group_monthly_assigned     TO authenticated;

-- RPCs called from application code
GRANT EXECUTE ON FUNCTION ledger_create_transfer                TO authenticated;
GRANT EXECUTE ON FUNCTION ledger_replace_allocations            TO authenticated;
GRANT EXECUTE ON FUNCTION ledger_update_amount_and_allocations  TO authenticated;
GRANT EXECUTE ON FUNCTION ready_to_assign_category_id           TO authenticated;
GRANT EXECUTE ON FUNCTION budget_month                          TO authenticated;

-- Ensure future tables/functions created in this schema also get grants
-- (prevents having to remember to add grants every time)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated;
