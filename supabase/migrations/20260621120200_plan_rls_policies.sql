-- Replace the permissive "authenticated = everything" policies (migration 004)
-- with plan-scoped ones. Root tables check their own plan_id; everything else is
-- checked transitively through its existing foreign keys. user_can_access_plan()
-- (migration 20260621120000) is SECURITY DEFINER, so these subqueries don't
-- recurse into plan_members' own RLS, and the existing FK indexes keep the EXISTS
-- checks cheap.

DROP POLICY "authenticated_all" ON category_groups;
DROP POLICY "authenticated_all" ON categories;
DROP POLICY "authenticated_all" ON accounts;
DROP POLICY "authenticated_all" ON transactions;
DROP POLICY "authenticated_all" ON transaction_allocations;
DROP POLICY "authenticated_all" ON monthly_budgets;
DROP POLICY "authenticated_all" ON targets;
-- Root tables -------------------------------------------------------------

CREATE POLICY "plan_access" ON category_groups
  FOR ALL TO authenticated
  USING (user_can_access_plan(plan_id))
  WITH CHECK (user_can_access_plan(plan_id));

CREATE POLICY "plan_access" ON accounts
  FOR ALL TO authenticated
  USING (user_can_access_plan(plan_id))
  WITH CHECK (user_can_access_plan(plan_id));

-- Transitive: one FK hop --------------------------------------------------

CREATE POLICY "plan_access" ON categories
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM category_groups g
      WHERE g.id = categories.group_id AND user_can_access_plan(g.plan_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM category_groups g
      WHERE g.id = categories.group_id AND user_can_access_plan(g.plan_id)
    )
  );

CREATE POLICY "plan_access" ON transactions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.id = transactions.account_id AND user_can_access_plan(a.plan_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.id = transactions.account_id AND user_can_access_plan(a.plan_id)
    )
  );

-- Transitive: two FK hops -------------------------------------------------

CREATE POLICY "plan_access" ON transaction_allocations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.id = transaction_allocations.transaction_id
        AND user_can_access_plan(a.plan_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.id = transaction_allocations.transaction_id
        AND user_can_access_plan(a.plan_id)
    )
  );

-- Transitive: category XOR group (monthly_budgets, targets) ---------------

CREATE POLICY "plan_access" ON monthly_budgets
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM categories c
      JOIN category_groups g ON g.id = c.group_id
      WHERE c.id = monthly_budgets.category_id AND user_can_access_plan(g.plan_id)
    )
    OR EXISTS (
      SELECT 1 FROM category_groups g
      WHERE g.id = monthly_budgets.group_id AND user_can_access_plan(g.plan_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM categories c
      JOIN category_groups g ON g.id = c.group_id
      WHERE c.id = monthly_budgets.category_id AND user_can_access_plan(g.plan_id)
    )
    OR EXISTS (
      SELECT 1 FROM category_groups g
      WHERE g.id = monthly_budgets.group_id AND user_can_access_plan(g.plan_id)
    )
  );

CREATE POLICY "plan_access" ON targets
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM categories c
      JOIN category_groups g ON g.id = c.group_id
      WHERE c.id = targets.category_id AND user_can_access_plan(g.plan_id)
    )
    OR EXISTS (
      SELECT 1 FROM category_groups g
      WHERE g.id = targets.group_id AND user_can_access_plan(g.plan_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM categories c
      JOIN category_groups g ON g.id = c.group_id
      WHERE c.id = targets.category_id AND user_can_access_plan(g.plan_id)
    )
    OR EXISTS (
      SELECT 1 FROM category_groups g
      WHERE g.id = targets.group_id AND user_can_access_plan(g.plan_id)
    )
  );
