-- Read-only SQL runner for the "Ask" page (natural language -> SQL agent).
--
-- The agent writes SQL from a model's output, so nothing about the SQL text is
-- trusted. Safety is enforced here, in the database, not by inspecting the text
-- in the app:
--
--   1. The transaction is switched to READ ONLY before the query runs. Postgres
--      lets a transaction drop to read-only at any point but never go back once
--      a query has run, so nothing in the user's SQL (or any function it calls)
--      can write: INSERT/UPDATE/DELETE, DDL, SELECT ... FOR UPDATE, nextval()
--      and writes inside volatile functions all fail with 25006.
--   2. The SQL is wrapped as a subquery, so it must be a single SELECT/WITH/
--      VALUES query: a data-modifying CTE is rejected ("must be at the top
--      level"), and semicolons (statement stacking) are refused outright.
--   3. SECURITY INVOKER: the query runs as the caller, so RLS limits it to the
--      caller's active plan exactly like the rest of the app.
--   4. The plan is EXPLAINed first and the query is refused if it would read a
--      table holding secrets (Plaid access tokens, push keys, invitation
--      tokens) or anything outside the public schema. Results are sent to an
--      AI provider, so those never leave the database this way.
--   5. Output is capped at p_max_rows (default 200, max 1000) rows, and the
--      role's statement_timeout still applies.
--
-- The rest of the request's transaction stays read-only too, which is fine:
-- PostgREST runs each RPC call in its own transaction.

CREATE FUNCTION ai_readonly_query(p_sql text, p_max_rows integer DEFAULT 200)
RETURNS json
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_sql text;
  v_max integer := least(greatest(coalesce(p_max_rows, 200), 1), 1000);
  v_inner text;
  v_plan json;
  v_node jsonb;
  v_schema text;
  v_relation text;
  v_rows json;
  v_truncated boolean := false;
BEGIN
  PERFORM set_config('transaction_read_only', 'on', true);
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'could not make the transaction read-only';
  END IF;

  -- Trailing semicolons and whitespace are harmless; any other semicolon
  -- could stack a second statement.
  v_sql := regexp_replace(coalesce(p_sql, ''), '[\s;]+$', '');
  IF btrim(v_sql) = '' THEN
    RAISE EXCEPTION 'query is empty' USING ERRCODE = '42601';
  END IF;
  IF position(';' IN v_sql) > 0 THEN
    RAISE EXCEPTION 'only a single statement is allowed (remove the semicolons)'
      USING ERRCODE = '42601';
  END IF;

  -- Newlines around the user's SQL so a trailing "-- comment" can't swallow
  -- the closing parenthesis.
  v_inner := format(E'SELECT * FROM (\n%s\n) AS user_query', v_sql);

  EXECUTE 'EXPLAIN (VERBOSE, FORMAT JSON) ' || v_inner INTO v_plan;
  FOR v_node IN
    SELECT n FROM jsonb_path_query(v_plan::jsonb, 'lax $.** ? (exists (@."Relation Name"))') AS n
  LOOP
    v_schema := v_node ->> 'Schema';
    v_relation := v_node ->> 'Relation Name';
    IF v_schema IS NOT NULL AND v_schema NOT IN ('public', 'pg_catalog', 'information_schema') THEN
      RAISE EXCEPTION 'reading from schema "%" is not allowed', v_schema
        USING ERRCODE = '42501';
    END IF;
    IF v_relation IN ('plaid_items', 'push_subscriptions', 'plan_invitations', 'user_active_plan') THEN
      RAISE EXCEPTION 'reading from "%" is not allowed', v_relation
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  EXECUTE format(
    'SELECT coalesce(json_agg(q), ''[]''::json) FROM (%s LIMIT %s) AS q',
    v_inner, v_max + 1
  ) INTO v_rows;

  IF json_array_length(v_rows) > v_max THEN
    v_truncated := true;
    SELECT coalesce(json_agg(e ORDER BY n), '[]'::json) INTO v_rows
    FROM json_array_elements(v_rows) WITH ORDINALITY AS t(e, n)
    WHERE n <= v_max;
  END IF;

  RETURN json_build_object('rows', v_rows, 'truncated', v_truncated);
END;
$$;

REVOKE ALL ON FUNCTION ai_readonly_query(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_readonly_query(text, integer) TO authenticated;
