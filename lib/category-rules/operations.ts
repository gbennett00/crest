import type { SupabaseClient } from "@supabase/supabase-js";

import { applyCategorySuggestions, LedgerError } from "@/lib/ledger";
import { ruleTargetsPayee, shouldOfferRule } from "./logic";
import type {
  CategoryRule,
  CategoryRuleInput,
  RulePreview,
  RulePrompt,
  RuleDirection,
  RuleMatchType,
} from "./types";

type RuleRow = {
  id: string;
  match_type: RuleMatchType;
  match_text: string;
  direction: RuleDirection;
  min_cents: number | null;
  max_cents: number | null;
  account_id: string | null;
  category_id: string;
  priority: number;
  created_at: string;
};

const RULE_COLUMNS =
  "id, match_type, match_text, direction, min_cents, max_cents, account_id, category_id, priority, created_at";

function mapRuleRow(row: RuleRow): CategoryRule {
  return {
    id: row.id,
    matchType: row.match_type,
    matchText: row.match_text,
    direction: row.direction,
    minCents: row.min_cents,
    maxCents: row.max_cents,
    accountId: row.account_id,
    categoryId: row.category_id,
    priority: row.priority,
    createdAt: row.created_at,
  };
}

function toRow(input: CategoryRuleInput) {
  return {
    match_type: input.matchType,
    match_text: input.matchText.trim(),
    direction: input.direction,
    min_cents: input.minCents,
    max_cents: input.maxCents,
    account_id: input.accountId,
    category_id: input.categoryId,
  };
}

/** The plan's rules in match order (first match wins). match_text comes back normalized. */
export async function listCategoryRules(
  client: SupabaseClient,
  planId: string,
): Promise<CategoryRule[]> {
  const { data, error } = await client
    .from("category_rules")
    .select(RULE_COLUMNS)
    .eq("plan_id", planId)
    .order("priority")
    .order("id");
  if (error) throw new LedgerError("db_error", error.message);
  return ((data ?? []) as RuleRow[]).map(mapRuleRow);
}

/** Renumbers the plan's rules in this order; the first is checked first. */
export async function reorderCategoryRules(
  client: SupabaseClient,
  planId: string,
  orderedIds: string[],
): Promise<void> {
  const { error } = await client.rpc("category_rules_reorder", {
    p_plan_id: planId,
    p_rule_ids: orderedIds,
  });
  if (error) throw new LedgerError("db_error", error.message);
}

/** New rules go to the top of the list (the DB assigns the priority). */
export async function createCategoryRule(
  client: SupabaseClient,
  planId: string,
  input: CategoryRuleInput,
): Promise<string> {
  const { data, error } = await client
    .from("category_rules")
    .insert({ plan_id: planId, ...toRow(input) })
    .select("id")
    .single();
  if (error) throw new LedgerError("db_error", error.message);
  return (data as { id: string }).id;
}

export async function updateCategoryRule(
  client: SupabaseClient,
  id: string,
  input: CategoryRuleInput,
): Promise<void> {
  const { error } = await client.from("category_rules").update(toRow(input)).eq("id", id);
  if (error) throw new LedgerError("db_error", error.message);
}

export async function deleteCategoryRule(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("category_rules").delete().eq("id", id);
  if (error) throw new LedgerError("db_error", error.message);
}

/** How many past transactions a would-be rule matches, with sample payees. */
export async function previewCategoryRule(
  client: SupabaseClient,
  planId: string,
  input: Omit<CategoryRuleInput, "categoryId">,
): Promise<RulePreview> {
  const { data, error } = await client
    .rpc("category_rule_preview", {
      p_plan_id: planId,
      p_match_type: input.matchType,
      p_match_text: input.matchText,
      p_direction: input.direction,
      p_min_cents: input.minCents,
      p_max_cents: input.maxCents,
      p_account_id: input.accountId,
    })
    .single();
  if (error) throw new LedgerError("db_error", error.message);
  const row = data as { match_count: number; sample_payees: string[] | null };
  return { matchCount: row.match_count, samplePayees: row.sample_payees ?? [] };
}

/**
 * Re-runs suggestions over every pending transaction in the plan, e.g. after a
 * rule changes. The DB function only touches rows still open to a suggestion,
 * so anything the user categorized themselves is left alone.
 */
export async function resuggestPendingTransactions(
  client: SupabaseClient,
  planId: string,
): Promise<number> {
  const { data, error } = await client
    .from("transactions")
    .select("id, accounts!transactions_account_id_fkey!inner(plan_id)")
    .is("approved_at", null)
    .eq("accounts.plan_id", planId);
  if (error) throw new LedgerError("db_error", error.message);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  return applyCategorySuggestions(client, ids);
}

/**
 * Decides, after a transaction was saved with `allocations`, whether to offer
 * "Always categorize <payee> as <category>?" — see shouldOfferRule for the
 * category condition. Also skipped when the payee has no usable key or the
 * plan already has a rule targeting it. Returns the prompt, or null.
 */
export async function buildRulePrompt(
  client: SupabaseClient,
  planId: string,
  transactionId: string,
  previousCategoryIds: string[],
  allocations: { categoryId: string }[],
): Promise<RulePrompt | null> {
  if (!shouldOfferRule(previousCategoryIds, allocations)) return null;

  const { data: txn, error } = await client
    .from("transactions")
    .select("payee, payee_key, amount_cents, account_id, transfer_account_id")
    .eq("id", transactionId)
    .maybeSingle();
  if (error) throw new LedgerError("db_error", error.message);
  const row = txn as {
    payee: string;
    payee_key: string | null;
    amount_cents: number;
    account_id: string;
    transfer_account_id: string | null;
  } | null;
  if (!row || !row.payee_key || row.transfer_account_id) return null;

  const direction: RuleDirection = row.amount_cents < 0 ? "outflow" : "inflow";
  const rules = await listCategoryRules(client, planId);
  if (rules.some((r) => ruleTargetsPayee(r, row.payee_key!, direction))) return null;

  const categoryId = allocations[0].categoryId;
  const { data: cat, error: catError } = await client
    .from("categories")
    .select("name, role")
    .eq("id", categoryId)
    .maybeSingle();
  if (catError) throw new LedgerError("db_error", catError.message);
  if (!cat) return null;
  const { name, role } = cat as { name: string; role: string | null };

  return {
    payee: row.payee,
    payeeKey: row.payee_key,
    direction,
    amountCents: row.amount_cents,
    accountId: row.account_id,
    categoryId,
    categoryName: role === "ready_to_assign" ? "Ready to Assign" : name,
  };
}
