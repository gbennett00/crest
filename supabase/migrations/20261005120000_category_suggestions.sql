-- Auto-categorization: suggest a category for incoming (unapproved)
-- transactions from user-defined rules, falling back to the payee's history.
-- See docs/budgeting-app-architecture.md § AUTO-CATEGORIZATION.
--
-- A suggestion is stored as an ordinary single allocation on the still-
-- unapproved transaction, tagged with `transactions.category_source`. Nothing
-- here ever sets approved_at: the user still approves every transaction, and
-- approval keeps whatever allocations the row already carries. Budget math is
-- unaffected until then — every budget read model counts approved rows only.
--
-- `category_source` is non-null only while the row's categories are exactly
-- what was suggested: the allocation-replacement RPCs clear it whenever a
-- caller changes the set of categories (see the end of this file).

-- ---------------------------------------------------------------------------
-- Payee normalization
-- ---------------------------------------------------------------------------

-- Matching key for a payee string. Plaid's merchant_name is usually clean
-- already ("Maverik"), but the raw-name fallback and manual entries are not
-- ("MAVERIK #117", "Chevron 0204513"). Lowercases, drops apostrophes, turns
-- punctuation into spaces, removes "#123" / "store 123" style location numbers
-- and any trailing all-digit words, and collapses whitespace. A payee that is
-- only digits ("76") is kept as-is. Empty input yields NULL.
CREATE FUNCTION normalize_payee(p_payee text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(lower(p_payee), '[''’]', '', 'g'),
              '#\s*\d+', ' ', 'g'),
            '\m(store|str|unit|no)\s*\.?\s*\d+\M', ' ', 'g'),
          '[^a-z0-9&]+', ' ', 'g'),
        '(\s+\d+)+\s*$', ''),
      ' '),
    '');
$$;

ALTER TABLE transactions
  ADD COLUMN payee_key text GENERATED ALWAYS AS (normalize_payee(payee)) STORED;

-- Payee-history lookups: the most recent approved, non-transfer rows for a key.
CREATE INDEX transactions_payee_key_history_idx
  ON transactions (payee_key, txn_date DESC)
  WHERE approved_at IS NOT NULL AND transfer_account_id IS NULL;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

CREATE TYPE category_rule_match AS ENUM ('exact', 'contains');
CREATE TYPE category_rule_direction AS ENUM ('outflow', 'inflow');

CREATE TABLE category_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  match_type  category_rule_match NOT NULL DEFAULT 'exact',
  -- Stored normalized (normalize_payee) by the trigger below, so it compares
  -- directly against transactions.payee_key.
  match_text  text NOT NULL,
  direction   category_rule_direction NOT NULL DEFAULT 'outflow',
  -- Optional bounds on the absolute amount: min inclusive, max exclusive, so
  -- "under $20" is max 2000 and "$20 and up" is min 2000 with no overlap.
  min_cents   bigint,
  max_cents   bigint,
  account_id  uuid REFERENCES accounts (id) ON DELETE CASCADE,
  -- A hidden (archived) category keeps its rules; they're skipped while it is
  -- hidden and flagged in the rules UI.
  category_id uuid NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT category_rules_min_nonnegative CHECK (min_cents IS NULL OR min_cents >= 0),
  CONSTRAINT category_rules_max_positive CHECK (max_cents IS NULL OR max_cents > 0),
  CONSTRAINT category_rules_range_ordered CHECK (
    min_cents IS NULL OR max_cents IS NULL OR min_cents < max_cents
  ),
  -- A very short "contains" text matches nearly everything.
  CONSTRAINT category_rules_contains_min_length CHECK (
    match_type <> 'contains' OR length(match_text) >= 3
  )
);

CREATE INDEX category_rules_plan_id_idx ON category_rules (plan_id);
CREATE INDEX category_rules_category_id_idx ON category_rules (category_id);
CREATE INDEX category_rules_account_id_idx ON category_rules (account_id)
  WHERE account_id IS NOT NULL;

-- Normalizes match_text and checks the category/account belong to the plan.
CREATE FUNCTION category_rules_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.match_text := normalize_payee(NEW.match_text);
  IF NEW.match_text IS NULL THEN
    RAISE EXCEPTION 'category rule match text is empty';
  END IF;

  IF budget_unit_plan_id(NEW.category_id, NULL) IS DISTINCT FROM NEW.plan_id THEN
    RAISE EXCEPTION 'category rule category does not belong to its plan';
  END IF;

  IF NEW.account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = NEW.account_id AND plan_id = NEW.plan_id
  ) THEN
    RAISE EXCEPTION 'category rule account does not belong to its plan';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER category_rules_before_write
  BEFORE INSERT OR UPDATE ON category_rules
  FOR EACH ROW
  EXECUTE FUNCTION category_rules_before_write();

ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_access" ON category_rules
  FOR ALL TO authenticated
  USING (user_can_access_plan(plan_id))
  WITH CHECK (user_can_access_plan(plan_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON category_rules TO authenticated;

-- ---------------------------------------------------------------------------
-- Suggestion provenance on transactions
-- ---------------------------------------------------------------------------

CREATE TYPE category_suggestion_source AS ENUM ('rule', 'history');

ALTER TABLE transactions
  ADD COLUMN category_source category_suggestion_source,
  -- Which rule produced a 'rule' suggestion. Set null if the rule is deleted;
  -- the source stays 'rule'.
  ADD COLUMN category_rule_id uuid REFERENCES category_rules (id) ON DELETE SET NULL;

CREATE INDEX transactions_category_rule_id_idx ON transactions (category_rule_id)
  WHERE category_rule_id IS NOT NULL;

-- Linking a row into a transfer strips its allocations (ledger_link_transfer),
-- so it no longer carries a suggestion either.
CREATE FUNCTION transactions_clear_suggestion_on_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.category_source := NULL;
  NEW.category_rule_id := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_clear_suggestion_on_transfer
  BEFORE UPDATE OF transfer_account_id ON transactions
  FOR EACH ROW
  WHEN (NEW.transfer_account_id IS NOT NULL AND NEW.category_source IS NOT NULL)
  EXECUTE FUNCTION transactions_clear_suggestion_on_transfer();

-- ---------------------------------------------------------------------------
-- Suggestion engine
-- ---------------------------------------------------------------------------

-- Whether a category may be suggested for a transaction of the given sign.
-- Mirrors the category picker: never hidden categories, the Sinking Fund, or
-- credit-card payment categories; Ready to Assign only for inflows.
CREATE FUNCTION category_suggestable(p_category_id uuid, p_inflow boolean)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.id = p_category_id
      AND NOT c.is_hidden
      AND c.role IS DISTINCT FROM 'sinking_fund'
      AND (c.role IS DISTINCT FROM 'ready_to_assign' OR p_inflow)
      AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.payment_category_id = c.id)
  );
$$;

-- Suggests a category for each of the given transactions that is still open
-- to a suggestion: unapproved, on-budget, not a transfer, with a payee, and
-- either uncategorized or carrying an earlier untouched suggestion (which is
-- recomputed, so a newly created rule can replace a history guess). Rows the
-- user has categorized themselves are never touched.
--
-- 1. Rules: the most specific matching rule wins — exact before contains,
--    then longer match text, then rules with more conditions (amount bounds,
--    account), then the newest.
-- 2. Payee history, for rows no rule matched: among the payee's last 10
--    approved transactions of the same direction in the plan, the category
--    used by at least 70% of them (a split counts as a vote for no category).
--
-- Writes one full-amount allocation per suggestion and returns how many rows
-- changed. Plan scoping is explicit (the Plaid webhook runs as service_role,
-- which bypasses RLS); called as an authenticated user, RLS applies on top.
CREATE FUNCTION ledger_apply_category_suggestions(p_transaction_ids uuid[])
RETURNS integer
LANGUAGE sql
AS $$
  WITH cand AS (
    SELECT t.id, t.payee_key, t.amount_cents, t.account_id, a.plan_id,
           t.amount_cents < 0 AS outflow
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.id = ANY (p_transaction_ids)
      AND t.approved_at IS NULL
      AND t.transfer_account_id IS NULL
      AND a.on_budget
      AND t.payee_key IS NOT NULL
      AND (
        t.category_source IS NOT NULL
        OR NOT EXISTS (
          SELECT 1 FROM transaction_allocations x WHERE x.transaction_id = t.id
        )
      )
  ),
  rule_pick AS (
    SELECT DISTINCT ON (c.id)
      c.id, r.category_id, 'rule'::category_suggestion_source AS source, r.id AS rule_id
    FROM cand c
    JOIN category_rules r
      ON r.plan_id = c.plan_id
     AND CASE r.match_type
           WHEN 'exact' THEN c.payee_key = r.match_text
           ELSE strpos(c.payee_key, r.match_text) > 0
         END
     AND (r.direction = 'outflow') = c.outflow
     AND (r.min_cents IS NULL OR abs(c.amount_cents) >= r.min_cents)
     AND (r.max_cents IS NULL OR abs(c.amount_cents) < r.max_cents)
     AND (r.account_id IS NULL OR r.account_id = c.account_id)
    WHERE category_suggestable(r.category_id, NOT c.outflow)
    ORDER BY c.id,
      (r.match_type = 'exact') DESC,
      length(r.match_text) DESC,
      (r.min_cents IS NOT NULL)::int + (r.max_cents IS NOT NULL)::int
        + (r.account_id IS NOT NULL)::int DESC,
      r.created_at DESC,
      r.id
  ),
  history_keys AS (
    SELECT DISTINCT c.plan_id, c.payee_key, c.outflow
    FROM cand c
    WHERE NOT EXISTS (SELECT 1 FROM rule_pick rp WHERE rp.id = c.id)
  ),
  history_votes AS (
    SELECT k.plan_id, k.payee_key, k.outflow, s.category_id
    FROM history_keys k
    CROSS JOIN LATERAL (
      SELECT t.id
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      WHERE t.payee_key = k.payee_key
        AND t.approved_at IS NOT NULL
        AND t.transfer_account_id IS NULL
        AND a.plan_id = k.plan_id
        AND a.on_budget
        AND (t.amount_cents < 0) = k.outflow
      ORDER BY t.txn_date DESC, t.created_at DESC
      LIMIT 10
    ) h
    CROSS JOIN LATERAL (
      SELECT CASE WHEN count(*) = 1 THEN (array_agg(ta.category_id))[1] END AS category_id
      FROM transaction_allocations ta
      WHERE ta.transaction_id = h.id
    ) s
  ),
  history_pick_by_key AS (
    SELECT plan_id, payee_key, outflow, category_id
    FROM (
      SELECT plan_id, payee_key, outflow, category_id,
             count(*) AS votes,
             sum(count(*)) OVER (PARTITION BY plan_id, payee_key, outflow) AS total
      FROM history_votes
      GROUP BY plan_id, payee_key, outflow, category_id
    ) v
    -- At a 70% threshold at most one category per key can qualify.
    WHERE category_id IS NOT NULL
      AND votes * 100 >= total * 70
      AND category_suggestable(category_id, NOT outflow)
  ),
  pick AS (
    SELECT id, category_id, source, rule_id FROM rule_pick
    UNION ALL
    SELECT c.id, h.category_id, 'history'::category_suggestion_source, NULL::uuid
    FROM cand c
    JOIN history_pick_by_key h
      ON h.plan_id = c.plan_id AND h.payee_key = c.payee_key AND h.outflow = c.outflow
    WHERE NOT EXISTS (SELECT 1 FROM rule_pick rp WHERE rp.id = c.id)
  ),
  -- Skip rows whose current state already is this exact suggestion.
  changed AS (
    SELECT p.id, p.category_id, p.source, p.rule_id, t.amount_cents
    FROM pick p
    JOIN transactions t ON t.id = p.id
    WHERE t.category_source IS DISTINCT FROM p.source
       OR t.category_rule_id IS DISTINCT FROM p.rule_id
       OR (
         SELECT count(*) FILTER (
                  WHERE ta.category_id = p.category_id AND ta.amount_cents = t.amount_cents)
                <> 1
             OR count(*) <> 1
         FROM transaction_allocations ta
         WHERE ta.transaction_id = p.id
       )
  ),
  -- All sub-statements share one snapshot: this removes only the old rows,
  -- never the ones inserted below.
  removed AS (
    DELETE FROM transaction_allocations ta
    USING changed ch
    WHERE ta.transaction_id = ch.id
    RETURNING ta.id
  ),
  inserted AS (
    INSERT INTO transaction_allocations (transaction_id, category_id, amount_cents)
    SELECT id, category_id, amount_cents FROM changed
    RETURNING id
  ),
  tagged AS (
    UPDATE transactions t
    SET category_source = ch.source, category_rule_id = ch.rule_id
    FROM changed ch
    WHERE t.id = ch.id
    RETURNING t.id
  )
  SELECT count(*)::int FROM tagged;
$$;

GRANT EXECUTE ON FUNCTION ledger_apply_category_suggestions(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Clear provenance when a caller changes a row's categories
-- ---------------------------------------------------------------------------

-- True when p_allocations names a different set of categories than the
-- transaction currently has. Amounts are ignored: keeping the suggested
-- category while editing the amount still counts as taking the suggestion.
CREATE FUNCTION allocation_categories_differ(p_transaction_id uuid, p_allocations jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    ARRAY(
      SELECT DISTINCT category_id FROM transaction_allocations
      WHERE transaction_id = p_transaction_id
      ORDER BY 1
    )
    IS DISTINCT FROM
    ARRAY(
      SELECT DISTINCT (elem->>'category_id')::uuid
      FROM jsonb_array_elements(p_allocations) AS elem
      ORDER BY 1
    );
$$;

CREATE OR REPLACE FUNCTION ledger_replace_allocations(
  p_transaction_id uuid,
  p_allocations     jsonb  -- [{category_id: uuid, amount_cents: bigint}]
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF allocation_categories_differ(p_transaction_id, p_allocations) THEN
    UPDATE transactions
    SET category_source = NULL, category_rule_id = NULL
    WHERE id = p_transaction_id AND category_source IS NOT NULL;
  END IF;

  DELETE FROM transaction_allocations WHERE transaction_id = p_transaction_id;

  IF jsonb_array_length(p_allocations) > 0 THEN
    INSERT INTO transaction_allocations (transaction_id, category_id, amount_cents)
    SELECT
      p_transaction_id,
      (elem->>'category_id')::uuid,
      (elem->>'amount_cents')::bigint
    FROM jsonb_array_elements(p_allocations) AS elem;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ledger_update_amount_and_allocations(
  p_transaction_id uuid,
  p_amount_cents    bigint,
  p_allocations     jsonb  -- [{category_id: uuid, amount_cents: bigint}]
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF allocation_categories_differ(p_transaction_id, p_allocations) THEN
    UPDATE transactions
    SET category_source = NULL, category_rule_id = NULL
    WHERE id = p_transaction_id AND category_source IS NOT NULL;
  END IF;

  UPDATE transactions SET amount_cents = p_amount_cents WHERE id = p_transaction_id;

  DELETE FROM transaction_allocations WHERE transaction_id = p_transaction_id;

  IF jsonb_array_length(p_allocations) > 0 THEN
    INSERT INTO transaction_allocations (transaction_id, category_id, amount_cents)
    SELECT
      p_transaction_id,
      (elem->>'category_id')::uuid,
      (elem->>'amount_cents')::bigint
    FROM jsonb_array_elements(p_allocations) AS elem;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: suggest categories for everything already waiting for approval
-- ---------------------------------------------------------------------------

SELECT ledger_apply_category_suggestions(
  ARRAY(SELECT id FROM transactions WHERE approved_at IS NULL)
);
