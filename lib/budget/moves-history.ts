// Display model for the "View moves" page: one funding unit's budget moves,
// grouped by the day they happened (in the viewer's time zone), each signed
// relative to that unit — positive into it, negative out of it.

import type { Cents } from "@/lib/ledger";

export type MoveSource = "user" | "cover" | "import" | "backfill";

/** One budget move as returned by /api/budget-moves. */
export type MoveRow = {
  id: string;
  /** Budget month affected (YYYY-MM-01). */
  month: string;
  /** When the move happened (ISO timestamp). */
  movedAt: string;
  amountCents: Cents;
  source: MoveSource;
  from: { id: string; name: string };
  to: { id: string; name: string };
};

export type MoveHistoryItem = {
  id: string;
  /** Budget month affected (YYYY-MM-01). */
  month: string;
  fromName: string;
  toName: string;
  /** +amount when money moved into the viewed unit, -amount when out. */
  signedCents: Cents;
  source: MoveSource;
};

export type MoveHistoryGroup = {
  /** "September 25, 2026", or "Before move history" for backfilled moves. */
  label: string;
  items: MoveHistoryItem[];
};

export const BACKFILL_GROUP_LABEL = "Before move history";

/**
 * Groups `rows` (any order) newest day first, newest move first within a day.
 * Backfilled moves — assignments that existed before moves were recorded, so
 * their real dates are unknown — go in one trailing group instead of under a
 * misleading date. Their `movedAt` is only when the old row was first saved
 * (often all at once by an import), so that group is ordered by budget month,
 * newest first: the only real chronology they have.
 */
export function buildMoveHistory(
  rows: MoveRow[],
  unitId: string,
  timeZone?: string,
): MoveHistoryGroup[] {
  const dayFormat = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const time = (row: MoveRow) => new Date(row.movedAt).getTime();
  const sorted = [...rows].sort((a, b) => time(b) - time(a));
  const groups: MoveHistoryGroup[] = [];
  const backfill: MoveHistoryItem[] = [];

  for (const row of sorted) {
    const item: MoveHistoryItem = {
      id: row.id,
      month: row.month,
      fromName: row.from.name,
      toName: row.to.name,
      signedCents: row.to.id === unitId ? row.amountCents : -row.amountCents,
      source: row.source,
    };
    if (row.source === "backfill") {
      backfill.push(item);
      continue;
    }
    const label = dayFormat.format(new Date(row.movedAt));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  if (backfill.length > 0) {
    // Stable sort: same-month moves keep their newest-saved-first order.
    backfill.sort((a, b) => b.month.localeCompare(a.month));
    groups.push({ label: BACKFILL_GROUP_LABEL, items: backfill });
  }
  return groups;
}
