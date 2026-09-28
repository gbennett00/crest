-- Budget moves: an append-only log of every movement of assigned money
-- between Ready to Assign, categories, and group-budgeted groups. The log is
-- the source of truth for assignments; `monthly_budgets` becomes a view that
-- sums it, so every existing reader (category_monthly_assigned,
-- group_monthly_assigned, the budget loader) keeps working unchanged.
--
-- Each row moves `amount_cents` (> 0) out of one funding unit and into
-- another for one budget month. Ready to Assign is stored as the plan's RTA
-- category id, never as null. `month` is the budget month affected;
-- `moved_at` is when the move actually happened (the two differ when
-- assigning to a future month or fixing a past one).
--
-- The old table is renamed to monthly_budgets_legacy and frozen rather than
-- dropped, so the backfill can be verified (monthly_budgets_backfill_check)
-- and rolled back. A later migration drops both.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The unscoped ready_to_assign_category_id() predates plans: it returns an
-- arbitrary plan's RTA wherever RLS doesn't narrow categories to one plan.
-- Nothing calls it; replace it with a plan-scoped version.
--
-- This and budget_unit_plan_id are SECURITY DEFINER lookups: they only map ids
-- to ids, and access is enforced by budget_moves' RLS on the resolved plan_id.
-- Running them as the caller would also be subtly wrong: plpgsql caches the
-- inlined query plan with the first role's RLS baked in, so a session that
-- switches role (e.g. authenticated -> service_role on a pooled connection)
-- could see "not found" for rows it can actually read.
DROP FUNCTION ready_to_assign_category_id();

CREATE FUNCTION ready_to_assign_category_id(p_plan_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id
  FROM categories c
  JOIN category_groups g ON g.id = c.group_id
  WHERE g.plan_id = p_plan_id AND c.role = 'ready_to_assign';
$$;

GRANT EXECUTE ON FUNCTION ready_to_assign_category_id(uuid) TO authenticated;

-- The plan owning a funding unit (exactly one of category / group is set).
-- Null when the unit doesn't exist.
CREATE FUNCTION budget_unit_plan_id(p_category_id uuid, p_group_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_category_id IS NOT NULL THEN (
      SELECT g.plan_id FROM categories c
      JOIN category_groups g ON g.id = c.group_id
      WHERE c.id = p_category_id
    )
    ELSE (SELECT g.plan_id FROM category_groups g WHERE g.id = p_group_id)
  END;
$$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TYPE budget_move_source AS ENUM ('user', 'cover', 'import', 'backfill');

CREATE TABLE budget_moves (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Set by the insert trigger from the funding units; callers may omit it.
  plan_id          uuid NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  month            date NOT NULL,
  moved_at         timestamptz NOT NULL DEFAULT now(),
  -- No ON DELETE action: deleting a category/group that has moves must fail
  -- rather than silently shift money. Plan deletion clears moves first (see
  -- delete_plan_children below).
  from_category_id uuid REFERENCES categories (id),
  from_group_id    uuid REFERENCES category_groups (id),
  to_category_id   uuid REFERENCES categories (id),
  to_group_id      uuid REFERENCES category_groups (id),
  amount_cents     bigint NOT NULL,
  source           budget_move_source NOT NULL,
  -- Who made the move. Stamped from auth.uid() by the insert trigger; null
  -- means system (backfill, service-role jobs). Deliberately no FK so the
  -- history survives user deletion.
  created_by       uuid,
  CONSTRAINT budget_moves_month_first_day CHECK (
    month = date_trunc('month', month)::date
  ),
  CONSTRAINT budget_moves_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT budget_moves_from_one_unit CHECK (
    (from_category_id IS NULL) <> (from_group_id IS NULL)
  ),
  CONSTRAINT budget_moves_to_one_unit CHECK (
    (to_category_id IS NULL) <> (to_group_id IS NULL)
  ),
  CONSTRAINT budget_moves_distinct_units CHECK (
    COALESCE(from_category_id, from_group_id) <> COALESCE(to_category_id, to_group_id)
  )
);

-- Moves screen: a plan's moves, newest first.
CREATE INDEX budget_moves_plan_moved_at_idx
  ON budget_moves (plan_id, moved_at DESC);

-- Assigned totals (the monthly_budgets view) and per-unit lookups in the
-- write functions: both scan one plan's moves up to a month.
CREATE INDEX budget_moves_plan_month_idx
  ON budget_moves (plan_id, month);

-- ---------------------------------------------------------------------------
-- Insert trigger: stamp authorship, derive + verify plan ownership
-- ---------------------------------------------------------------------------

CREATE FUNCTION budget_moves_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_from_plan uuid;
  v_to_plan uuid;
BEGIN
  -- Callers can't choose who or when: an authenticated insert is always
  -- attributed to the caller at the current time. Only contexts without a
  -- user (migrations, service role) may write null / a historical moved_at.
  NEW.created_by := auth.uid();
  IF NEW.created_by IS NOT NULL THEN
    NEW.moved_at := now();
  END IF;

  v_from_plan := budget_unit_plan_id(NEW.from_category_id, NEW.from_group_id);
  v_to_plan   := budget_unit_plan_id(NEW.to_category_id, NEW.to_group_id);

  IF v_from_plan IS NULL THEN
    RAISE EXCEPTION 'budget move source not found';
  END IF;
  IF v_to_plan IS NULL THEN
    RAISE EXCEPTION 'budget move destination not found';
  END IF;
  IF v_from_plan <> v_to_plan THEN
    RAISE EXCEPTION 'budget move source and destination belong to different plans';
  END IF;
  IF NEW.plan_id IS NOT NULL AND NEW.plan_id <> v_from_plan THEN
    RAISE EXCEPTION 'budget move plan_id does not match its categories';
  END IF;

  NEW.plan_id := v_from_plan;
  RETURN NEW;
END;
$$;

CREATE TRIGGER budget_moves_before_insert
  BEFORE INSERT ON budget_moves
  FOR EACH ROW
  EXECUTE FUNCTION budget_moves_before_insert();

-- ---------------------------------------------------------------------------
-- Access: plan members can read and append; nobody edits history
-- ---------------------------------------------------------------------------

ALTER TABLE budget_moves ENABLE ROW LEVEL SECURITY;

-- The caller's plan ids, evaluated once per query. The policies compare
-- plan_id against this array rather than calling user_can_access_plan() per
-- row: the monthly_budgets view reads every move twice, and a per-row
-- function call (which also can't use an index) made the budget page's
-- assigned query ~150x slower in benchmarks. `= ANY(ARRAY(...))` lets the
-- planner use the (plan_id, ...) indexes.
CREATE FUNCTION user_plan_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT plan_id FROM plan_members WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION user_plan_ids() TO authenticated;

CREATE POLICY "plan_access_select" ON budget_moves
  FOR SELECT TO authenticated
  USING (plan_id = ANY (ARRAY(SELECT user_plan_ids())));

CREATE POLICY "plan_access_insert" ON budget_moves
  FOR INSERT TO authenticated
  WITH CHECK (plan_id = ANY (ARRAY(SELECT user_plan_ids())));

-- Default privileges grant UPDATE/DELETE on new tables; moves are append-only.
REVOKE UPDATE, DELETE, TRUNCATE ON budget_moves FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retire the monthly_budgets table
-- ---------------------------------------------------------------------------

-- These views bind to the table itself, not its name, so they'd keep reading
-- the legacy table after the rename. Drop now; recreated over the new view.
DROP VIEW category_monthly_assigned;
DROP VIEW group_monthly_assigned;

ALTER TABLE monthly_budgets RENAME TO monthly_budgets_legacy;

-- Frozen snapshot: readable for verification, never written again.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON monthly_budgets_legacy FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: one move per non-zero legacy assignment
-- ---------------------------------------------------------------------------
--
-- Positive: RTA -> unit. Negative: unit -> RTA. moved_at is the legacy row's
-- created_at (when it was first saved; the true edit history is unknown), and
-- source = 'backfill' lets the UI present these as pre-history. Legacy rows on
-- the RTA category itself are skipped (nothing writes them; RTA is derived).

DO $$
DECLARE
  v_skipped integer;
BEGIN
  SELECT count(*) INTO v_skipped
  FROM monthly_budgets_legacy mb
  JOIN categories c ON c.id = mb.category_id
  WHERE c.role = 'ready_to_assign' AND mb.assigned_cents <> 0;

  IF v_skipped > 0 THEN
    RAISE NOTICE 'budget_moves backfill: skipped % legacy row(s) on Ready to Assign', v_skipped;
  END IF;
END $$;

WITH legacy AS (
  SELECT
    mb.month,
    mb.category_id,
    mb.group_id,
    mb.assigned_cents,
    mb.created_at,
    ready_to_assign_category_id(budget_unit_plan_id(mb.category_id, mb.group_id)) AS rta_id
  FROM monthly_budgets_legacy mb
  LEFT JOIN categories c ON c.id = mb.category_id
  WHERE mb.assigned_cents <> 0
    AND c.role IS DISTINCT FROM 'ready_to_assign'
)
INSERT INTO budget_moves (
  month, moved_at,
  from_category_id, from_group_id, to_category_id, to_group_id,
  amount_cents, source
)
SELECT
  month,
  created_at,
  CASE WHEN assigned_cents > 0 THEN rta_id ELSE category_id END,
  CASE WHEN assigned_cents > 0 THEN NULL   ELSE group_id    END,
  CASE WHEN assigned_cents > 0 THEN category_id ELSE rta_id END,
  CASE WHEN assigned_cents > 0 THEN group_id    ELSE NULL   END,
  abs(assigned_cents),
  'backfill'
FROM legacy;

-- ---------------------------------------------------------------------------
-- monthly_budgets: assigned totals derived from the move log
-- ---------------------------------------------------------------------------
--
-- Each move counts +amount for its destination and -amount for its source;
-- summing per (month, unit) gives the assigned total. RTA's own (negative)
-- side is excluded: the budget computes RTA separately. LEFT JOIN because
-- group rows have no category; IS DISTINCT FROM so those null-role rows stay.

CREATE VIEW monthly_budgets
WITH (security_invoker = true)
AS
SELECT
  s.month,
  s.category_id,
  s.group_id,
  SUM(s.delta)::bigint AS assigned_cents
FROM (
  SELECT month, to_category_id AS category_id, to_group_id AS group_id, amount_cents AS delta
  FROM budget_moves
  UNION ALL
  SELECT month, from_category_id, from_group_id, -amount_cents
  FROM budget_moves
) s
LEFT JOIN categories c ON c.id = s.category_id
WHERE c.role IS DISTINCT FROM 'ready_to_assign'
GROUP BY s.month, s.category_id, s.group_id;

-- Recreated exactly as before (20260524120001 / 20260524120003), now over the view.
CREATE VIEW category_monthly_assigned
WITH (security_invoker = true)
AS
SELECT
  category_id,
  month,
  assigned_cents
FROM monthly_budgets
WHERE category_id IS NOT NULL;

CREATE VIEW group_monthly_assigned
WITH (security_invoker = true)
AS
SELECT
  group_id,
  month,
  assigned_cents
FROM monthly_budgets
WHERE group_id IS NOT NULL;

-- Read-only (the aggregate view isn't updatable anyway; make it explicit).
REVOKE ALL ON monthly_budgets, category_monthly_assigned, group_monthly_assigned
  FROM anon, authenticated;
GRANT SELECT ON monthly_budgets, category_monthly_assigned, group_monthly_assigned
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Backfill verification
-- ---------------------------------------------------------------------------
--
-- Legacy assignments vs. the sum of *backfill* moves only (real moves made
-- after the migration legitimately diverge from the legacy snapshot). Should
-- always be empty. Dropped together with monthly_budgets_legacy.

CREATE VIEW monthly_budgets_backfill_check
WITH (security_invoker = true)
AS
WITH legacy AS (
  SELECT mb.month, mb.category_id, mb.group_id, mb.assigned_cents
  FROM monthly_budgets_legacy mb
  LEFT JOIN categories c ON c.id = mb.category_id
  WHERE mb.assigned_cents <> 0
    AND c.role IS DISTINCT FROM 'ready_to_assign'
),
backfill AS (
  SELECT s.month, s.category_id, s.group_id, SUM(s.delta)::bigint AS assigned_cents
  FROM (
    SELECT month, to_category_id AS category_id, to_group_id AS group_id, amount_cents AS delta
    FROM budget_moves WHERE source = 'backfill'
    UNION ALL
    SELECT month, from_category_id, from_group_id, -amount_cents
    FROM budget_moves WHERE source = 'backfill'
  ) s
  LEFT JOIN categories c ON c.id = s.category_id
  WHERE c.role IS DISTINCT FROM 'ready_to_assign'
  GROUP BY s.month, s.category_id, s.group_id
)
SELECT
  COALESCE(l.month, b.month) AS month,
  COALESCE(l.category_id, b.category_id) AS category_id,
  COALESCE(l.group_id, b.group_id) AS group_id,
  l.assigned_cents AS legacy_cents,
  b.assigned_cents AS backfill_cents
FROM legacy l
FULL OUTER JOIN backfill b
  ON b.month = l.month
 AND b.category_id IS NOT DISTINCT FROM l.category_id
 AND b.group_id IS NOT DISTINCT FROM l.group_id
WHERE l.assigned_cents IS DISTINCT FROM b.assigned_cents;

REVOKE ALL ON monthly_budgets_backfill_check FROM anon, authenticated;
GRANT SELECT ON monthly_budgets_backfill_check TO authenticated;

-- ---------------------------------------------------------------------------
-- Write functions
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER (the default): RLS and the insert trigger apply, so a
-- caller can only move money within plans they belong to.

-- Set absolute assigned amounts. For each row, records the difference from
-- the unit's current total as a move with Ready to Assign (RTA -> unit when
-- increasing, unit -> RTA when decreasing; nothing when unchanged). This is
-- what the assigned cell, the assign popup, and "assign to cover" send.
-- Rows: [{ month, category_id | group_id, assigned_cents }].
CREATE FUNCTION ledger_set_assigned(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
  v_plan uuid;
  v_rta uuid;
  v_current bigint;
  v_delta bigint;
BEGIN
  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_rows)
      AS t(month date, category_id uuid, group_id uuid, assigned_cents bigint)
  LOOP
    IF (r.category_id IS NULL) = (r.group_id IS NULL) THEN
      RAISE EXCEPTION 'exactly one of category_id / group_id is required';
    END IF;
    IF r.month IS NULL OR r.assigned_cents IS NULL THEN
      RAISE EXCEPTION 'month and assigned_cents are required';
    END IF;

    v_plan := budget_unit_plan_id(r.category_id, r.group_id);
    IF v_plan IS NULL THEN
      RAISE EXCEPTION 'category or group not found';
    END IF;
    v_rta := ready_to_assign_category_id(v_plan);
    IF r.category_id = v_rta THEN
      RAISE EXCEPTION 'cannot assign directly to Ready to Assign';
    END IF;

    -- Serialize concurrent edits of the same unit+month (e.g. two tabs), so
    -- both can't compute their delta from the same starting total.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'budget_unit:' || COALESCE(r.category_id, r.group_id)::text || ':' || r.month::text, 0));

    SELECT COALESCE(SUM(
      CASE WHEN m.to_category_id = r.category_id OR m.to_group_id = r.group_id
        THEN m.amount_cents ELSE -m.amount_cents END
    ), 0)
    INTO v_current
    FROM budget_moves m
    WHERE m.plan_id = v_plan
      AND m.month = r.month
      AND (m.to_category_id = r.category_id OR m.from_category_id = r.category_id
        OR m.to_group_id = r.group_id OR m.from_group_id = r.group_id);

    v_delta := r.assigned_cents - v_current;

    IF v_delta > 0 THEN
      INSERT INTO budget_moves (month, from_category_id, to_category_id, to_group_id, amount_cents, source)
      VALUES (r.month, v_rta, r.category_id, r.group_id, v_delta, 'user');
    ELSIF v_delta < 0 THEN
      INSERT INTO budget_moves (month, from_category_id, from_group_id, to_category_id, amount_cents, source)
      VALUES (r.month, r.category_id, r.group_id, v_rta, -v_delta, 'user');
    END IF;
  END LOOP;
END;
$$;

-- Record explicit moves between funding units, atomically.
-- Moves: [{ month, from_category_id | from_group_id, to_category_id | to_group_id, amount_cents }].
-- A side with neither id set means the plan's Ready to Assign (resolved from
-- the other side), so callers don't need to know the RTA category id.
CREATE FUNCTION ledger_move_money(p_moves jsonb, p_source budget_move_source DEFAULT 'user')
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
  v_rta uuid;
BEGIN
  IF p_source NOT IN ('user', 'cover') THEN
    RAISE EXCEPTION 'invalid source for ledger_move_money: %', p_source;
  END IF;

  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_moves) AS t(
      month date,
      from_category_id uuid, from_group_id uuid,
      to_category_id uuid, to_group_id uuid,
      amount_cents bigint)
  LOOP
    IF r.from_category_id IS NULL AND r.from_group_id IS NULL THEN
      v_rta := ready_to_assign_category_id(budget_unit_plan_id(r.to_category_id, r.to_group_id));
      r.from_category_id := v_rta;
    ELSIF r.to_category_id IS NULL AND r.to_group_id IS NULL THEN
      v_rta := ready_to_assign_category_id(budget_unit_plan_id(r.from_category_id, r.from_group_id));
      r.to_category_id := v_rta;
    END IF;

    -- CHECK constraints and the insert trigger validate the rest.
    INSERT INTO budget_moves (
      month, from_category_id, from_group_id, to_category_id, to_group_id, amount_cents, source
    ) VALUES (
      r.month, r.from_category_id, r.from_group_id, r.to_category_id, r.to_group_id,
      r.amount_cents, p_source
    );
  END LOOP;
END;
$$;

-- YNAB import (replaces the monthly_budgets upsert). Same contract as before:
-- a (month, category) that already has any moves is left alone, so a
-- re-import never reverts an edit made in the Budget page. Otherwise the
-- imported amount is recorded as an 'import' move with Ready to Assign.
CREATE OR REPLACE FUNCTION ledger_bulk_upsert_category_budgets(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r record;
  v_plan uuid;
  v_rta uuid;
BEGIN
  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_rows)
      AS t(month date, category_id uuid, assigned_cents bigint)
  LOOP
    CONTINUE WHEN r.assigned_cents = 0;

    v_plan := budget_unit_plan_id(r.category_id, NULL);
    v_rta := ready_to_assign_category_id(v_plan);
    CONTINUE WHEN r.category_id = v_rta;

    PERFORM pg_advisory_xact_lock(hashtextextended(
      'budget_unit:' || r.category_id::text || ':' || r.month::text, 0));

    CONTINUE WHEN EXISTS (
      SELECT 1 FROM budget_moves m
      WHERE m.plan_id = v_plan
        AND m.month = r.month
        AND (m.to_category_id = r.category_id OR m.from_category_id = r.category_id)
    );

    INSERT INTO budget_moves (month, from_category_id, to_category_id, amount_cents, source)
    VALUES (
      r.month,
      CASE WHEN r.assigned_cents > 0 THEN v_rta ELSE r.category_id END,
      CASE WHEN r.assigned_cents > 0 THEN r.category_id ELSE v_rta END,
      abs(r.assigned_cents),
      'import'
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION ledger_set_assigned(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION ledger_move_money(jsonb, budget_move_source) TO authenticated;
GRANT EXECUTE ON FUNCTION ledger_bulk_upsert_category_budgets(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Plan deletion: clear moves before categories/groups
-- ---------------------------------------------------------------------------
--
-- Same as 20260815130000 plus step 0: budget_moves' category/group FKs have
-- no ON DELETE action, so the plan's moves must go before its categories.

CREATE OR REPLACE FUNCTION delete_plan_children()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 0. Budget moves (they reference the plan's categories and groups).
  DELETE FROM budget_moves WHERE plan_id = OLD.id;

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

  -- 3. Categories of the plan's groups. monthly_budgets_legacy and targets
  --    cascade from categories; allocations and payment-category references
  --    are gone.
  DELETE FROM categories
  WHERE group_id IN (SELECT id FROM category_groups WHERE plan_id = OLD.id);

  -- 4. Category groups. Their categories are gone (RESTRICT satisfied);
  --    remaining group-level monthly_budgets_legacy/targets rows cascade.
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
