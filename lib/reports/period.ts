import {
  currentBudgetMonth,
  nextBudgetMonth,
  previousBudgetMonth,
} from "@/lib/ledger";

/**
 * "month" | "3m" | "6m" | "year" | "all" | "y<YYYY>" (an arbitrary past year,
 * e.g. "y2024") | "m<YYYY-MM>" (an arbitrary specific month, e.g. "m2026-07").
 * Kept as a plain string (not a union) so it round-trips through URL search
 * params without extra parsing.
 */
export type PeriodKey = string;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type PeriodRange = {
  /** Inclusive lower bound, budget-month format (YYYY-MM-01), or null for no lower bound. */
  from: string | null;
  /** Exclusive upper bound, budget-month format (YYYY-MM-01), or null for no upper bound. */
  to: string | null;
  label: string;
};

export const DEFAULT_PERIOD_KEY: PeriodKey = "month";

const YEAR_KEY_RE = /^y(\d{4})$/;

/** Returns the year for a "y<YYYY>" period key, or null if `key` isn't one. */
export function yearFromPeriodKey(key: string): number | null {
  const m = YEAR_KEY_RE.exec(key);
  return m ? +m[1] : null;
}

export function yearPeriodKey(year: number): PeriodKey {
  return `y${year}`;
}

const MONTH_KEY_RE = /^m(\d{4}-\d{2})$/;

/** Returns the budget month (YYYY-MM-01) for an "m<YYYY-MM>" period key, or null if `key` isn't one. */
export function monthFromPeriodKey(key: string): string | null {
  const m = MONTH_KEY_RE.exec(key);
  return m ? `${m[1]}-01` : null;
}

export function monthPeriodKey(month: string): PeriodKey {
  return `m${month.slice(0, 7)}`;
}

export function formatMonthLabel(month: string): string {
  const y = +month.slice(0, 4);
  const mi = +month.slice(5, 7);
  return `${MONTH_NAMES[mi - 1]} ${y}`;
}

/** `count` consecutive budget months ending at `today`, oldest first. */
export function lastNMonths(count: number, today: string = currentBudgetMonth()): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) months.push(shiftBudgetMonth(today, -i));
  return months;
}

function shiftBudgetMonth(month: string, delta: number): string {
  let m = month;
  if (delta >= 0) {
    for (let i = 0; i < delta; i++) m = nextBudgetMonth(m);
  } else {
    for (let i = 0; i < -delta; i++) m = previousBudgetMonth(m);
  }
  return m;
}

/**
 * Resolves a period key to a `[from, to)` budget-month range. `today` is
 * injectable for tests; defaults to the real current budget month.
 */
export function getPeriodRange(
  key: PeriodKey,
  today: string = currentBudgetMonth(),
): PeriodRange {
  const currentYear = +today.slice(0, 4);

  switch (key) {
    case "month":
      return { from: today, to: nextBudgetMonth(today), label: "This Month" };
    case "3m":
      return {
        from: shiftBudgetMonth(today, -2),
        to: nextBudgetMonth(today),
        label: "Last 3 Months",
      };
    case "6m":
      return {
        from: shiftBudgetMonth(today, -5),
        to: nextBudgetMonth(today),
        label: "Last 6 Months",
      };
    case "year":
      return {
        from: `${currentYear}-01-01`,
        to: `${currentYear + 1}-01-01`,
        label: "This Year",
      };
    case "all":
      return { from: null, to: null, label: "All Time" };
  }

  const year = yearFromPeriodKey(key);
  if (year !== null) {
    return { from: `${year}-01-01`, to: `${year + 1}-01-01`, label: String(year) };
  }

  const month = monthFromPeriodKey(key);
  if (month !== null) {
    return { from: month, to: nextBudgetMonth(month), label: formatMonthLabel(month) };
  }

  // Unrecognized key (e.g. a stale/tampered URL) — fall back to this month.
  return { from: today, to: nextBudgetMonth(today), label: "This Month" };
}
