-- Category rules, round two (see docs/budgeting-app-architecture.md
-- § AUTO-CATEGORIZATION):
--
-- 1. Explicit priority. Rules are checked in `priority` order (lowest first)
--    and the first match wins, so the user decides precedence by reordering
--    them instead of relying on the implicit specificity ranking. Existing
--    rules are numbered by that old ranking, so nothing changes for them
--    until they're reordered. New rules go to the top.
-- 2. Inclusive maximum. Amount bounds now read "$X or less" / "$X or more" /
--    "$X to $Y", so max_cents becomes inclusive like min_cents. Existing
--    maximums drop by one cent to keep matching exactly what they did.

-- ---------------------------------------------------------------------------
-- Priority
-- ---------------------------------------------------------------------------

ALTER TABLE category_rules ADD COLUMN priority integer;

UPDATE category_rules r
SET priority = ranked.n
FROM (
  SELECT id, row_number() OVER (
    PARTITION BY plan_id
    ORDER BY
      (match_type = 'exact') DESC,
      length(match_text) DESC,
      (min_cents IS NOT NULL)::int + (max_cents IS NOT NULL)::int
        + (account_id IS NOT NULL)::int DESC,
      created_at DESC,
      id
  )::int AS n
  FROM category_rules
) ranked
WHERE r.id = ranked.id;

ALTER TABLE category_rules ALTER COLUMN priority SET NOT NULL;

CREATE INDEX category_rules_plan_priority_idx ON category_rules (plan_id, priority);

-- New rules default to the top of their plan's list.
CREATE FUNCTION category_rules_default_priority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.priority IS NULL THEN
    SELECT COALESCE(min(priority), 1) - 1 INTO NEW.priority
    FROM category_rules
    WHERE plan_id = NEW.plan_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER category_rules_default_priority
  BEFORE INSERT ON category_rules
  FOR EACH ROW
  EXECUTE FUNCTION category_rules_default_priority();

-- Renumbers a plan's rules 1..n in the given order (first = checked first).
-- Ids not in the plan are ignored; rules left out keep their relative order
-- after the listed ones. Runs as the caller, so RLS applies.
CREATE FUNCTION category_rules_reorder(p_plan_id uuid, p_rule_ids uuid[])
RETURNS void
LANGUAGE sql
AS $$
  UPDATE category_rules r
  SET priority = ordered.n
  FROM (
    SELECT id, row_number() OVER (
      ORDER BY array_position(p_rule_ids, id) NULLS LAST, priority, id
    )::int AS n
    FROM category_rules
    WHERE plan_id = p_plan_id
  ) ordered
  WHERE r.id = ordered.id AND r.priority IS DISTINCT FROM ordered.n;
$$;

GRANT EXECUTE ON FUNCTION category_rules_reorder(uuid, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Inclusive maximum
-- ---------------------------------------------------------------------------

ALTER TABLE category_rules DROP CONSTRAINT category_rules_range_ordered;

UPDATE category_rules SET max_cents = GREATEST(max_cents - 1, 1) WHERE max_cents IS NOT NULL;

ALTER TABLE category_rules ADD CONSTRAINT category_rules_range_ordered CHECK (
  min_cents IS NULL OR max_cents IS NULL OR min_cents <= max_cents
);

COMMENT ON COLUMN category_rules.max_cents IS
  'Inclusive upper bound on the absolute amount (min_cents is inclusive too).';

-- ---------------------------------------------------------------------------
-- Matching: priority order, inclusive maximum (otherwise unchanged)
-- ---------------------------------------------------------------------------

-- Rule step: the first matching rule in priority order wins. The rest is as
-- in 20261005120000.
CREATE OR REPLACE FUNCTION ledger_apply_category_suggestions(p_transaction_ids uuid[])
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
     AND (r.max_cents IS NULL OR abs(c.amount_cents) <= r.max_cents)
     AND (r.account_id IS NULL OR r.account_id = c.account_id)
    WHERE category_suggestable(r.category_id, NOT c.outflow)
    ORDER BY c.id, r.priority, r.id
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

CREATE OR REPLACE FUNCTION category_rule_preview(
  p_plan_id    uuid,
  p_match_type category_rule_match,
  p_match_text text,
  p_direction  category_rule_direction,
  p_min_cents  bigint,
  p_max_cents  bigint,
  p_account_id uuid
)
RETURNS TABLE (match_count integer, sample_payees text[])
LANGUAGE sql
STABLE
AS $$
  WITH needle AS (SELECT normalize_payee(p_match_text) AS key),
  matched AS (
    SELECT t.payee
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    CROSS JOIN needle n
    WHERE n.key IS NOT NULL
      AND a.plan_id = p_plan_id
      AND a.on_budget
      AND t.transfer_account_id IS NULL
      AND CASE p_match_type
            WHEN 'exact' THEN t.payee_key = n.key
            ELSE strpos(t.payee_key, n.key) > 0
          END
      AND (p_direction = 'outflow') = (t.amount_cents < 0)
      AND (p_min_cents IS NULL OR abs(t.amount_cents) >= p_min_cents)
      AND (p_max_cents IS NULL OR abs(t.amount_cents) <= p_max_cents)
      AND (p_account_id IS NULL OR t.account_id = p_account_id)
  )
  SELECT
    (SELECT count(*)::int FROM matched),
    ARRAY(
      SELECT payee FROM matched GROUP BY payee ORDER BY count(*) DESC, payee LIMIT 5
    );
$$;

-- Rule order or bounds may have changed what pending rows should get.
SELECT ledger_apply_category_suggestions(
  ARRAY(SELECT id FROM transactions WHERE approved_at IS NULL)
);
