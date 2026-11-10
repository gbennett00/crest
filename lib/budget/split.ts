/**
 * Pure rules for the approve drawer's split (YNAB-style: pick categories,
 * then enter amounts). Amounts here are magnitudes in cents; the
 * transaction's sign is applied only when building allocations.
 */

export type SplitLine = { categoryId: string; amountCents: number };

/** What is still unassigned (negative when the lines go over). */
export function splitRemaining(totalAbsCents: number, lines: readonly SplitLine[]): number {
  return totalAbsCents - lines.reduce((sum, l) => sum + l.amountCents, 0);
}

/**
 * The amount line `index` should take so nothing is left over: its current
 * amount plus whatever remains (or minus the overage), never below zero.
 */
export function amountUsingRemaining(
  totalAbsCents: number,
  lines: readonly SplitLine[],
  index: number,
): number {
  return Math.max(0, lines[index].amountCents + splitRemaining(totalAbsCents, lines));
}

export type SplitProblem = "too_few" | "zero_amount" | "short" | "over";

/** Why the split can't be approved yet, or null when it can. */
export function splitProblem(totalAbsCents: number, lines: readonly SplitLine[]): SplitProblem | null {
  if (lines.length < 2) return "too_few";
  if (lines.some((l) => l.amountCents <= 0)) return "zero_amount";
  const remaining = splitRemaining(totalAbsCents, lines);
  if (remaining > 0) return "short";
  if (remaining < 0) return "over";
  return null;
}

/**
 * Lines for a new set of chosen categories, in the order chosen: amounts are
 * kept for categories that were already in the split, new ones start at 0.
 */
export function linesForCategories(
  categoryIds: readonly string[],
  previous: readonly SplitLine[],
): SplitLine[] {
  const kept = new Map(previous.map((l) => [l.categoryId, l.amountCents]));
  return categoryIds.map((categoryId) => ({ categoryId, amountCents: kept.get(categoryId) ?? 0 }));
}

/** Signed allocations for a transaction of `txnAmountCents` (negative = outflow). */
export function toAllocations(
  lines: readonly SplitLine[],
  txnAmountCents: number,
): { categoryId: string; amountCents: number }[] {
  const sign = txnAmountCents < 0 ? -1 : 1;
  return lines.map((l) => ({ categoryId: l.categoryId, amountCents: sign * l.amountCents }));
}

/** An existing split (signed allocations) as magnitude lines. */
export function linesFromAllocations(
  allocations: readonly { categoryId: string; amountCents: number }[],
): SplitLine[] {
  return allocations.map((a) => ({ categoryId: a.categoryId, amountCents: Math.abs(a.amountCents) }));
}
