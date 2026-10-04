import { formatCents } from "@/lib/format";
import type { CategoryRuleInput, RuleDirection } from "./types";

/** Minimum length of a "contains" rule's match text (mirrors the DB check). */
export const CONTAINS_MIN_LENGTH = 3;

/**
 * Validates a rule before it's sent to the DB, which enforces the same
 * constraints. Returns a user-facing message, or null when valid. `matchText`
 * is checked as typed; the DB stores it normalized.
 */
export function validateRuleInput(input: CategoryRuleInput): string | null {
  const text = input.matchText.trim();
  if (!text) return "Enter the payee text to match.";
  if (input.matchType === "contains" && text.length < CONTAINS_MIN_LENGTH) {
    return `"Contains" rules need at least ${CONTAINS_MIN_LENGTH} characters.`;
  }
  if (!input.categoryId) return "Choose a category.";
  for (const cents of [input.minCents, input.maxCents]) {
    if (cents !== null && (!Number.isInteger(cents) || cents < 0)) {
      return "Amounts must be zero or more.";
    }
  }
  if (input.maxCents === 0) return "The upper amount must be more than $0.00.";
  if (input.minCents !== null && input.maxCents !== null && input.minCents >= input.maxCents) {
    return "The lower amount must be less than the upper amount.";
  }
  return null;
}

/**
 * Whether a rule targets this payee at all, ignoring its amount and account
 * conditions. Used to skip the "make this a rule?" prompt for a payee the
 * user has already written a rule for. Mirrors the SQL match in
 * ledger_apply_category_suggestions; both keys are already normalized.
 */
export function ruleTargetsPayee(
  rule: { matchType: CategoryRuleInput["matchType"]; matchText: string; direction: RuleDirection },
  payeeKey: string,
  direction: RuleDirection,
): boolean {
  if (rule.direction !== direction) return false;
  return rule.matchType === "exact"
    ? rule.matchText === payeeKey
    : payeeKey.includes(rule.matchText);
}

/**
 * Whether saving these allocations should offer to make a rule: the user
 * chose a single category that differs from what the transaction had before
 * (nothing, a suggestion they overrode, or an earlier pick). Re-saving the
 * same category, or splitting, never prompts.
 */
export function shouldOfferRule(
  previousCategoryIds: string[],
  allocations: { categoryId: string }[],
): boolean {
  if (allocations.length !== 1) return false;
  const chosen = allocations[0].categoryId;
  return !(previousCategoryIds.length === 1 && previousCategoryIds[0] === chosen);
}

/** Human summary of a rule's conditions, e.g. "Outflow · under $20.00 · Checking". */
export function describeRuleConditions(
  rule: Pick<CategoryRuleInput, "direction" | "minCents" | "maxCents">,
  accountName: string | null,
): string {
  const parts: string[] = [rule.direction === "outflow" ? "Outflow" : "Inflow"];
  const { minCents, maxCents } = rule;
  if (minCents !== null && maxCents !== null) {
    parts.push(`${formatCents(minCents)} to under ${formatCents(maxCents)}`);
  } else if (maxCents !== null) {
    parts.push(`under ${formatCents(maxCents)}`);
  } else if (minCents !== null) {
    parts.push(`${formatCents(minCents)} or more`);
  }
  if (accountName) parts.push(accountName);
  return parts.join(" · ");
}
