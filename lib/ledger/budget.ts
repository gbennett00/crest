import { LedgerError } from "./errors";
import type { Cents } from "./types";

const BUDGET_MONTH_RE = /^\d{4}-\d{2}-01$/;

export function assertBudgetMonth(month: string): void {
  if (!BUDGET_MONTH_RE.test(month)) {
    throw new LedgerError("invalid_month", "budget month must be YYYY-MM-01");
  }
}

export function currentBudgetMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export function nextBudgetMonth(month: string): string {
  assertBudgetMonth(month);
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export function previousBudgetMonth(month: string): string {
  assertBudgetMonth(month);
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  return m === 1
    ? `${y - 1}-12-01`
    : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

/** Core available formula: available = last_month_available + assigned + activity */
export function computeAvailable(
  lastMonthAvailable: Cents,
  assignedCents: Cents,
  activityCents: Cents,
): Cents {
  return lastMonthAvailable + assignedCents + activityCents;
}

/**
 * Iterates forward from the earliest month with any data, accumulating the
 * available balance, and returns the value at `throughMonth`.
 *
 * `activityByMonth` and `assignedByMonth` must only contain entries whose
 * keys are <= `throughMonth` (the DB queries enforce this via `.lte`).
 */
export function computeAvailableThrough(
  throughMonth: string,
  activityByMonth: Record<string, Cents>,
  assignedByMonth: Record<string, Cents>,
): Cents {
  assertBudgetMonth(throughMonth);

  const candidates = [
    ...Object.keys(activityByMonth),
    ...Object.keys(assignedByMonth),
  ].filter((m) => m <= throughMonth);

  if (candidates.length === 0) return 0;

  const earliest = candidates.reduce((a, b) => (a < b ? a : b));

  let available = 0;
  let current = earliest;
  while (current <= throughMonth) {
    available = computeAvailable(
      available,
      assignedByMonth[current] ?? 0,
      activityByMonth[current] ?? 0,
    );
    current = nextBudgetMonth(current);
  }
  return available;
}
