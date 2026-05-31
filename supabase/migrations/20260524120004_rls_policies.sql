-- Enable RLS on every table and grant full access to authenticated users.
--
-- There is no user_id column yet (multi-user is not in MVP scope).
-- "Authenticated = can do everything" is the correct invariant while there
-- is only one user and new signups are disabled in the Supabase dashboard.
-- When multi-user support is added, add user_id columns and narrow these
-- policies to USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid()).

ALTER TABLE category_groups           ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories                ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_allocations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_budgets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE targets                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_settings           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON category_groups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all" ON categories
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all" ON accounts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all" ON transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all" ON transaction_allocations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all" ON monthly_budgets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all" ON targets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_all" ON budget_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
