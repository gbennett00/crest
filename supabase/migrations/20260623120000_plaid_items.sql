-- Stores Plaid Item metadata: access tokens, sync cursors, connection status.
-- One Item per bank login; each Item may have multiple Crest accounts.

CREATE TABLE plaid_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES plans(id),
  plaid_item_id   text NOT NULL UNIQUE,
  access_token    text NOT NULL,
  institution_id   text,
  institution_name text,
  transactions_cursor text,
  status       text NOT NULL DEFAULT 'good',
  error_code   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_plaid_items_plan_id ON plaid_items(plan_id);

-- RLS: plan-scoped access (matches the pattern from 20260621120200).
ALTER TABLE plaid_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_access" ON plaid_items
  FOR ALL TO authenticated
  USING (user_can_access_plan(plan_id))
  WITH CHECK (user_can_access_plan(plan_id));

-- Service-role bypasses RLS automatically — no extra policy needed for webhooks.

-- FK from accounts.plaid_item_id → plaid_items.plaid_item_id so lookups
-- during sync can join on the text Plaid ID directly.
ALTER TABLE accounts
  ADD CONSTRAINT fk_accounts_plaid_item
  FOREIGN KEY (plaid_item_id) REFERENCES plaid_items(plaid_item_id);
