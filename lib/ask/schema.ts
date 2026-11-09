import type { RunSql } from "./agent";

/** Tables the database refuses to read through ai_readonly_query (secrets). */
export const BLOCKED_TABLES = ["plaid_items", "push_subscriptions", "plan_invitations", "user_active_plan"];

// Hand-written semantics the column list alone can't convey. Keep in sync with
// CLAUDE.md "Database rules" / "Key invariants".
export const DOMAIN_NOTES = `Domain rules (Crest, a zero-based budgeting app like YNAB):
- All money columns are bigint cents (*_cents). Divide by 100.0 for dollars.
- amount_cents sign: negative = outflow (spending), positive = inflow (income, refunds).
- Budget months are DATE values on the first of the month. budget_month(d date) returns the first of d's month.
- transactions: one row per bank/manual transaction. txn_date is the economic date. payee is free text; payee_key is a normalized payee.
  approved_at IS NULL means unapproved (e.g. a fresh bank import) and does NOT count toward budget activity; most questions should filter approved_at IS NOT NULL.
  transfer_account_id IS NOT NULL marks one side of a transfer between two accounts; exclude transfers from income/spending questions.
- transaction_allocations: category splits of a transaction (transaction_id, category_id, amount_cents, same sign as the parent). Spending by category = sum of allocations joined to approved transactions.
- categories belong to category_groups (group_id). categories.role = 'ready_to_assign' is the single income bucket: inflows are categorized there. Exclude it when measuring spending; income = its positive activity. Hidden categories have is_hidden = true.
- accounts.type: checking, savings, credit (on-budget) and asset, liability (tracking). Credit accounts have a payment_category_id. balance_cents is the bank-reported balance used only for reconciliation; for real balances use the account_balances view.
- Assignments (money budgeted to categories) are rows in budget_moves; monthly_budgets is a view summing them per category/group and month.
- Read models: category_monthly_activity (category_id, month, activity_cents) sums approved allocations per month; category_monthly_assigned likewise for assignments; account_balances and account_monthly_balance give balances.
- Row-level security already limits every table to the user's own budget; never filter by plan_id or user id.`;

const COLUMNS_SQL = `
select c.table_name,
       t.table_type,
       string_agg(c.column_name || ' ' || case when c.data_type = 'USER-DEFINED' then c.udt_name else c.data_type end,
                  ', ' order by c.ordinal_position) as columns
from information_schema.columns c
join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
where c.table_schema = 'public'
  and c.table_name not in (${BLOCKED_TABLES.map((t) => `'${t}'`).join(", ")})
group by c.table_name, t.table_type
order by c.table_name`;

const ENUMS_SQL = `
select t.typname as name, string_agg(e.enumlabel, ', ' order by e.enumsortorder) as labels
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
group by t.typname
order by t.typname`;

type ColumnRow = { table_name: string; table_type: string; columns: string };
type EnumRow = { name: string; labels: string };

export function formatSchema(tables: ColumnRow[], enums: EnumRow[]): string {
  const lines = tables.map(
    (t) => `${t.table_type === "VIEW" ? "view" : "table"} ${t.table_name}(${t.columns})`,
  );
  const enumLines = enums.map((e) => `enum ${e.name}: ${e.labels}`);
  return [...lines, ...enumLines].join("\n");
}

/**
 * Introspects the public schema the caller can see, through the same
 * read-only runner the agent uses, so the model always gets current columns.
 */
export async function loadSchemaDescription(runSql: RunSql): Promise<string> {
  const [tables, enums] = await Promise.all([runSql(COLUMNS_SQL, 500), runSql(ENUMS_SQL, 200)]);
  return formatSchema(tables.rows as ColumnRow[], enums.rows as EnumRow[]);
}
