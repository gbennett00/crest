-- Deleting a plan should delete everything owned by that plan: accounts,
-- categories, category groups, transactions, allocations, monthly budgets,
-- targets, and Plaid items.
--
-- Plan ownership lives on two root tables (category_groups, accounts) plus
-- plaid_items, all keyed by plan_id. Everything else is owned transitively via
-- foreign keys. Most of those transitive FKs use ON DELETE RESTRICT / NO ACTION
-- on purpose — they stop you from deleting an account that still has
-- transactions, a category that's still in use, etc., during normal operation.
-- Those guards would also block a plain `DELETE FROM plans`, and plaid_items'
-- plan_id FK (NO ACTION) blocks it outright.
--
-- Rather than weaken those per-entity guards, we tear the plan's data down in
-- dependency order from a BEFORE DELETE trigger, so the RESTRICT/NO ACTION
-- constraints stay intact for everyday deletes but a plan deletion removes the
-- whole subtree.

CREATE OR REPLACE FUNCTION delete_plan_children()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Transactions of the plan's accounts. transaction_allocations cascade
  --    from transactions (ON DELETE CASCADE). Match both account_id and
  --    transfer_account_id so the transfer counterpart rows go too.
  DELETE FROM transactions
  WHERE account_id IN (SELECT id FROM accounts WHERE plan_id = OLD.id)
     OR transfer_account_id IN (SELECT id FROM accounts WHERE plan_id = OLD.id);

  -- 2. Accounts. Now unblocked (their transactions are gone); this also frees
  --    categories referenced via payment_category_id and plaid_items referenced
  --    via plaid_item_id.
  DELETE FROM accounts WHERE plan_id = OLD.id;

  -- 3. Categories of the plan's groups. monthly_budgets and targets cascade
  --    from categories; allocations and payment-category references are gone.
  DELETE FROM categories
  WHERE group_id IN (SELECT id FROM category_groups WHERE plan_id = OLD.id);

  -- 4. Category groups. Their categories are gone (RESTRICT satisfied);
  --    remaining group-level monthly_budgets/targets cascade.
  DELETE FROM category_groups WHERE plan_id = OLD.id;

  -- 5. Plaid items. Unblocked now that no account references them, and this
  --    clears the plaid_items -> plans FK (NO ACTION) that would otherwise
  --    block the plan row delete.
  DELETE FROM plaid_items WHERE plan_id = OLD.id;

  -- plan_members cascades from plans (ON DELETE CASCADE); the plan row delete
  -- proceeds after this trigger returns.
  RETURN OLD;
END;
$$;

CREATE TRIGGER plans_delete_children
  BEFORE DELETE ON plans
  FOR EACH ROW
  EXECUTE FUNCTION delete_plan_children();

GRANT EXECUTE ON FUNCTION delete_plan_children() TO authenticated;
