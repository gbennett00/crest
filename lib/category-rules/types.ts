import type { Cents } from "@/lib/ledger/types";

export type RuleMatchType = "exact" | "contains";
export type RuleDirection = "outflow" | "inflow";

/** What the user edits; amounts are absolute cents (min inclusive, max exclusive). */
export type CategoryRuleInput = {
  matchType: RuleMatchType;
  matchText: string;
  direction: RuleDirection;
  minCents: Cents | null;
  maxCents: Cents | null;
  accountId: string | null;
  categoryId: string;
};

export type CategoryRule = CategoryRuleInput & {
  id: string;
  createdAt: string;
};

/**
 * Offered after the user picks a category for an imported transaction: "Always
 * categorize <payee> as <category>?". `payeeKey` is the DB's normalized payee
 * (transactions.payee_key), used both as the rule's match text and as the
 * per-device dismissal key.
 */
export type RulePrompt = {
  payee: string;
  payeeKey: string;
  direction: RuleDirection;
  amountCents: Cents;
  accountId: string;
  categoryId: string;
  categoryName: string;
};

export type RulePreview = {
  matchCount: number;
  samplePayees: string[];
};
