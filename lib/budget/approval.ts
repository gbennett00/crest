/**
 * Pure helpers for the Home approval flow: ranking a payee's recent
 * categories into quick-pick suggestions, and deciding what bulk Approve
 * needs to ask for. No database access here; load-home-view.ts feeds them.
 */

/** How far back payee history counts toward suggestions. */
export const SUGGESTION_WINDOW_DAYS = 90;
/** Quick-pick categories shown in the approve drawer. */
export const SUGGESTION_LIMIT = 4;

/** One approved, non-transfer transaction from a payee's recent history. */
export type PayeeHistoryRow = {
  payeeKey: string;
  txnDate: string;
  categoryIds: string[];
};

/**
 * Ranks the categories each payee was approved into, most used first. A split
 * transaction counts once for each distinct category it touches. Ties go to
 * the category used most recently, then to id order so the result is stable.
 * Categories missing from `validCategoryIds` (hidden or deleted) are left out.
 */
export function rankPayeeCategories(
  history: PayeeHistoryRow[],
  validCategoryIds: ReadonlySet<string>,
): Map<string, string[]> {
  type Tally = { count: number; lastDate: string };
  const byPayee = new Map<string, Map<string, Tally>>();

  for (const row of history) {
    let tallies = byPayee.get(row.payeeKey);
    if (!tallies) {
      tallies = new Map();
      byPayee.set(row.payeeKey, tallies);
    }
    for (const categoryId of new Set(row.categoryIds)) {
      if (!validCategoryIds.has(categoryId)) continue;
      const t = tallies.get(categoryId);
      if (t) {
        t.count++;
        if (row.txnDate > t.lastDate) t.lastDate = row.txnDate;
      } else {
        tallies.set(categoryId, { count: 1, lastDate: row.txnDate });
      }
    }
  }

  const ranked = new Map<string, string[]>();
  for (const [payeeKey, tallies] of byPayee) {
    const ids = [...tallies.entries()]
      .sort(
        ([idA, a], [idB, b]) =>
          b.count - a.count ||
          b.lastDate.localeCompare(a.lastDate) ||
          idA.localeCompare(idB),
      )
      .map(([id]) => id);
    if (ids.length > 0) ranked.set(payeeKey, ids);
  }
  return ranked;
}

/**
 * The quick picks for one pending transaction: the category it already
 * carries (a rule or history suggestion) first, then the payee's ranked
 * categories, without duplicates, capped at `limit`.
 */
export function suggestionsFor(
  currentCategoryId: string | null,
  ranked: readonly string[] | undefined,
  limit: number = SUGGESTION_LIMIT,
): string[] {
  const out: string[] = [];
  if (currentCategoryId) out.push(currentCategoryId);
  for (const id of ranked ?? []) {
    if (out.length >= limit) break;
    if (!out.includes(id)) out.push(id);
  }
  return out.slice(0, limit);
}

/** What bulk Approve needs to know about each selected pending row. */
export type ApprovalRow = {
  /** The row's single category, or null when uncategorized or split. */
  categoryId: string | null;
  /** True when the row carries any category (single or split). */
  categorized: boolean;
};

export type BulkApprovalPlan =
  /** Every row has a category: approve in one tap, each keeps its own. */
  | { kind: "as-is" }
  /**
   * Some rows have none: ask for one category, applied to every row. It is
   * prefilled when every categorized row shares the same single category.
   */
  | { kind: "choose"; prefillCategoryId: string | null };

export function planBulkApproval(rows: readonly ApprovalRow[]): BulkApprovalPlan {
  if (rows.every((r) => r.categorized)) return { kind: "as-is" };

  const categorized = rows.filter((r) => r.categorized);
  const first = categorized[0]?.categoryId ?? null;
  const allSame =
    first !== null && categorized.every((r) => r.categoryId === first);
  return { kind: "choose", prefillCategoryId: allSame ? first : null };
}

/** Earliest txn_date (YYYY-MM-DD) inside the suggestion window, from `today`. */
export function suggestionWindowStart(
  today: Date,
  days: number = SUGGESTION_WINDOW_DAYS,
): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
