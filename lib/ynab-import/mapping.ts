import type { AccountType } from "@/lib/ledger/types";
import type { PlanParseResult, RegisterParseResult } from "./types";

export type ExistingAccount = { id: string; name: string; type: AccountType };
export type ExistingCategoryGroup = { id: string; name: string };
export type ExistingCategory = { id: string; name: string; groupId: string };

export type AccountMappingCandidate = {
  csvName: string;
  /** Its Starting Balance row (if any) had no category — likely a YNAB Tracking account. */
  looksOffBudget: boolean;
  existingMatch: ExistingAccount | null;
};

export type CategoryMappingCandidate = {
  categoryGroup: string;
  category: string;
  existingCategoryMatch: { groupId: string; categoryId: string } | null;
  /** The group exists already, even if this specific category under it doesn't. */
  existingGroupMatch: { groupId: string } | null;
};

const READY_TO_ASSIGN_GROUP = "Inflow";
const READY_TO_ASSIGN_CATEGORY = "Ready to Assign";
const CREDIT_CARD_PAYMENTS_GROUP = "Credit Card Payments";

/** "Inflow: Ready to Assign" is a built-in special case, never a mapping prompt. */
export function isReadyToAssignCategory(categoryGroup: string, category: string): boolean {
  return categoryGroup === READY_TO_ASSIGN_GROUP && category === READY_TO_ASSIGN_CATEGORY;
}

/** "Credit Card Payments: <account>" resolves to that account's payment category, never a created category. */
export function isCreditCardPaymentCategory(categoryGroup: string): boolean {
  return categoryGroup === CREDIT_CARD_PAYMENTS_GROUP;
}

export function collectAccountNames(register: RegisterParseResult): string[] {
  const names = new Set<string>();
  for (const t of register.transactions) names.add(t.account);
  for (const t of register.transfers) {
    names.add(t.fromAccount);
    names.add(t.toAccount);
  }
  for (const b of register.openingBalances) names.add(b.account);
  return [...names].sort();
}

export function buildAccountMappingCandidates(
  register: RegisterParseResult,
  existingAccounts: ExistingAccount[],
): AccountMappingCandidate[] {
  const offBudget = new Set(register.offBudgetAccounts);
  const byName = new Map(existingAccounts.map((a) => [a.name, a]));

  return collectAccountNames(register).map((csvName) => ({
    csvName,
    looksOffBudget: offBudget.has(csvName),
    existingMatch: byName.get(csvName) ?? null,
  }));
}

export function collectCategoryPairs(
  register: RegisterParseResult,
  plan: PlanParseResult,
): { categoryGroup: string; category: string }[] {
  const seen = new Map<string, { categoryGroup: string; category: string }>();
  const add = (categoryGroup: string, category: string) => {
    if (!categoryGroup && !category) return;
    if (isReadyToAssignCategory(categoryGroup, category)) return;
    if (isCreditCardPaymentCategory(categoryGroup)) return;
    seen.set(`${categoryGroup}||${category}`, { categoryGroup, category });
  };

  for (const t of register.transactions) {
    for (const a of t.allocations) add(a.categoryGroup, a.category);
  }
  for (const a of plan.assignments) add(a.categoryGroup, a.category);

  return [...seen.values()].sort((a, b) =>
    a.categoryGroup === b.categoryGroup
      ? a.category.localeCompare(b.category)
      : a.categoryGroup.localeCompare(b.categoryGroup),
  );
}

export function buildCategoryMappingCandidates(
  register: RegisterParseResult,
  plan: PlanParseResult,
  existingGroups: ExistingCategoryGroup[],
  existingCategories: ExistingCategory[],
): CategoryMappingCandidate[] {
  const groupByName = new Map(existingGroups.map((g) => [g.name, g]));
  const categoryByGroupAndName = new Map(
    existingCategories.map((c) => [`${c.groupId}||${c.name}`, c]),
  );

  return collectCategoryPairs(register, plan).map(({ categoryGroup, category }) => {
    const group = groupByName.get(categoryGroup);
    if (!group) {
      return { categoryGroup, category, existingCategoryMatch: null, existingGroupMatch: null };
    }
    const cat = categoryByGroupAndName.get(`${group.id}||${category}`);
    return {
      categoryGroup,
      category,
      existingCategoryMatch: cat ? { groupId: group.id, categoryId: cat.id } : null,
      existingGroupMatch: { groupId: group.id },
    };
  });
}
