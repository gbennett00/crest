import type { BudgetMoveInput, BudgetUnit } from "@/lib/ledger";
import { computeRtaBreakdown } from "./compute";
import { unitKey } from "./move-money";
import type { BudgetData, RtaBreakdown } from "./types";

// Applies pending assignment writes to a computed budget view, so an
// assignment shows the moment it's made (see lib/queries/budget.ts). Every
// write (setting an amount, moving money, covering overspending) is expressed
// as absolute assigned amounts for the units it touches, so applying it again
// to data that already includes it changes nothing.
//
// For the viewed month, changing a unit's assignment by `delta` changes its
// available by `delta` (carry-in from earlier months is what gets floored,
// not this month's own money) and its group's subtotal by `delta`, and grows
// assignedThisMonth by `delta`. Ready to Assign is then recomputed with the
// server's own computeRtaBreakdown: usually it drops by `delta`, but not while
// money assigned to future months is being covered by future income. Later months, and
// earlier months' "assigned in the future" line, also move; those are left to
// the refetch that follows every write.

export type AssignTarget = { unit: BudgetUnit; assignedCents: number };

/** The breakdown after this month's assignments change by `delta`. */
function shiftAssignedThisMonth(breakdown: RtaBreakdown, delta: number): RtaBreakdown {
  // The breakdown keeps the prior-month terms only as their net (leftover),
  // and future assignments split into the part this month's cash covers and
  // the rest; computeRtaBreakdown only needs those totals.
  return computeRtaBreakdown({
    inflowPriorCents: breakdown.leftoverFromPriorCents,
    assignedPriorCents: 0,
    earlierCashOverspendCents: 0,
    inflowThisMonthCents: breakdown.inflowThisMonthCents,
    assignedThisMonthCents: breakdown.assignedThisMonthCents + delta,
    previousMonthCashOverspendCents: breakdown.previousMonthCashOverspendCents,
    assignedFutureRawCents:
      breakdown.assignedFutureCents + breakdown.futureCoveredByFutureIncomeCents,
  });
}

function currentAssigned(data: BudgetData, unit: BudgetUnit): number | null {
  for (const group of data.groups) {
    if (unit.type === "group") {
      if (group.id === unit.id) return group.groupAssignedCents;
      continue;
    }
    const cat = group.categories.find((c) => c.id === unit.id);
    if (cat) return cat.assignedCents;
  }
  return null;
}

/**
 * Returns `data` with each target's unit assigned its amount, for `month`.
 * Data for another month, or units not in it, are left alone; unchanged data
 * comes back as the same object.
 */
export function withAssignments(
  data: BudgetData,
  month: string,
  targets: AssignTarget[],
): BudgetData {
  if (data.month !== month) return data;

  let next = data;
  for (const { unit, assignedCents } of targets) {
    const current = currentAssigned(next, unit);
    if (current === null || current === assignedCents) continue;
    const delta = assignedCents - current;

    const rtaBreakdown = shiftAssignedThisMonth(next.rtaBreakdown, delta);
    next = {
      ...next,
      rtaAvailableCents: rtaBreakdown.totalCents,
      rtaBreakdown,
      groups: next.groups.map((group) => {
        if (unit.type === "group") {
          return group.id === unit.id
            ? {
                ...group,
                groupAssignedCents: assignedCents,
                groupAvailableCents: group.groupAvailableCents + delta,
              }
            : group;
        }
        if (!group.categories.some((c) => c.id === unit.id)) return group;
        return {
          ...group,
          categories: group.categories.map((c) =>
            c.id === unit.id
              ? { ...c, assignedCents, availableCents: c.availableCents + delta }
              : c,
          ),
          // A category-budgeted group's available is the sum of its members.
          // (In a group-budgeted group the category isn't a funding unit, so
          // the group's own available doesn't move.)
          ...(group.budgetMode === "category" && {
            groupAvailableCents: group.groupAvailableCents + delta,
          }),
        };
      }),
    };
  }
  return next;
}

/**
 * The absolute targets a batch of budget moves amounts to, read against the
 * month's `data`: each unit's current assignment plus what moves into it,
 * minus what moves out. Ready to Assign isn't a target; it follows from the
 * deltas.
 */
export function targetsForMoves(data: BudgetData, moves: BudgetMoveInput[]): AssignTarget[] {
  const byKey = new Map<string, AssignTarget>();
  function shift(unit: BudgetUnit, delta: number) {
    const key = unitKey(unit);
    const existing = byKey.get(key);
    const base = existing?.assignedCents ?? currentAssigned(data, unit);
    if (base === null) return;
    byKey.set(key, { unit, assignedCents: base + delta });
  }
  for (const move of moves) {
    if (typeof move.from !== "string") shift(move.from, -move.amountCents);
    if (typeof move.to !== "string") shift(move.to, move.amountCents);
  }
  return [...byKey.values()];
}
