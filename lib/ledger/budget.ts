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

/**
 * Cash-overspend-aware availability, matching YNAB's month rollover.
 *
 * `computeAvailableThrough` carries every negative available straight into the
 * next month. YNAB does not: at each month boundary it splits an overspent
 * category's negative into two parts and treats them differently:
 *
 *  - **cash overspending** — the part not backed by a credit card — does *not*
 *    roll forward. The category resets to $0 next month and the overspend is
 *    charged to that month's Ready to Assign (the cash is simply gone).
 *  - **credit overspending** — uncovered credit-card purchases — *does* roll
 *    forward as a negative, because it is debt tracked in the category (the same
 *    behavior `computeAvailableThrough` already gives, and what Crest's
 *    funded-spending logic surfaces as an underfunded payment category).
 *
 * `creditOutflowByMonth[m]` is the magnitude (>= 0) of this funding unit's
 * credit-card outflow in month `m`. The uncovered portion of that outflow (what
 * the unit had no funds to cover, capped by the pre-purchase balance) is the
 * credit debt that keeps rolling; everything else negative is cash overspend.
 * Omit it (or pass `{}`) for a unit with no credit spending, and every overspend
 * is treated as cash.
 *
 * Returns:
 *  - `availableCents` — the available at `throughMonth`, *not* floored. The
 *    viewed month still shows its own overspend in red; only the roll into
 *    *later* months resets. Equals `computeAvailableThrough` when the running
 *    balance never goes negative on a cash boundary.
 *  - `cashOverspentBeforeCents` — total cash overspend (>= 0) charged at
 *    boundaries strictly before `throughMonth`, i.e. cash overspending that has
 *    already been deducted from Ready to Assign by the time you view
 *    `throughMonth`.
 */
export function computeAvailableWithOverspend(
  throughMonth: string,
  activityByMonth: Record<string, Cents>,
  assignedByMonth: Record<string, Cents>,
  creditOutflowByMonth: Record<string, Cents> = {},
): { availableCents: Cents; cashOverspentBeforeCents: Cents } {
  assertBudgetMonth(throughMonth);

  const candidates = [
    ...Object.keys(activityByMonth),
    ...Object.keys(assignedByMonth),
    ...Object.keys(creditOutflowByMonth),
  ].filter((m) => m <= throughMonth);

  if (candidates.length === 0) {
    return { availableCents: 0, cashOverspentBeforeCents: 0 };
  }

  const earliest = candidates.reduce((a, b) => (a < b ? a : b));

  let carry = 0; // floored available carried in (>= 0 surplus, or < 0 credit debt)
  let creditDebt = 0; // outstanding uncovered credit-card debt (>= 0)
  let cashOverspentBefore = 0;
  let raw = 0;
  let current = earliest;
  while (current <= throughMonth) {
    raw = carry + (assignedByMonth[current] ?? 0) + (activityByMonth[current] ?? 0);
    if (current === throughMonth) break; // return raw; the viewed month is not floored

    // New uncovered credit this month: the credit outflow the unit couldn't
    // cover. The pre-purchase balance (everything except the credit outflow) is
    // `raw + out`; funded spending is capped there, the rest becomes debt.
    const out = creditOutflowByMonth[current] ?? 0;
    const funded = Math.max(0, Math.min(out, raw + out));
    const debtFloor = creditDebt + (out - funded);

    // Keep the credit-debt portion of a negative; floor the cash portion to 0.
    const carryNext = Math.max(raw, -debtFloor);
    cashOverspentBefore += carryNext - raw; // >= 0 (carryNext >= raw)
    creditDebt = Math.max(0, -carryNext); // a negative carry is, by construction, all credit debt
    carry = carryNext;
    current = nextBudgetMonth(current);
  }

  return { availableCents: raw, cashOverspentBeforeCents: cashOverspentBefore };
}
