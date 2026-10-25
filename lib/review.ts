// Pure rules for the Home Review drawer: what an Approve acts on, how it is
// labelled, and which rows need a category first.

export type ReviewRow = {
  id: string;
  amountCents: number;
  /** Category name, "Split (n)", or null when uncategorized. */
  categoryLabel: string | null;
};

/** The selected rows, or every row when nothing is selected ("Approve all"). */
export function approvalTargets<T extends { id: string }>(
  rows: readonly T[],
  selected: ReadonlySet<string>,
): T[] {
  const picked = rows.filter((r) => selected.has(r.id));
  return picked.length === 0 ? [...rows] : picked;
}

/** How many of the rows are explicitly selected (ignores ids no longer listed). */
export function selectedCount(rows: readonly { id: string }[], selected: ReadonlySet<string>): number {
  return rows.reduce((n, r) => (selected.has(r.id) ? n + 1 : n), 0);
}

/** "Approve all 10" with nothing selected, "Approve 2" with a selection. */
export function approveLabel(targetCount: number, hasSelection: boolean): string {
  return hasSelection ? `Approve ${targetCount}` : `Approve all ${targetCount}`;
}

/** The sub-header's right-hand text: "10 to review" or "2 selected · -$85.96". */
export function reviewSummary(
  rows: readonly ReviewRow[],
  selected: ReadonlySet<string>,
  formatCents: (cents: number) => string,
): string {
  const picked = rows.filter((r) => selected.has(r.id));
  if (picked.length === 0) return `${rows.length} to review`;
  const total = picked.reduce((sum, r) => sum + r.amountCents, 0);
  return `${picked.length} selected · ${formatCents(total)}`;
}

/** Rows that need a category before they can be approved, and rows that keep theirs. */
export function splitByCategory<T extends { categoryLabel: string | null }>(
  rows: readonly T[],
): { uncategorized: T[]; categorized: T[] } {
  return {
    uncategorized: rows.filter((r) => r.categoryLabel === null),
    categorized: rows.filter((r) => r.categoryLabel !== null),
  };
}

/** Toast text after an approval. */
export function approvedMessage(count: number): string {
  return `${count} approved`;
}
