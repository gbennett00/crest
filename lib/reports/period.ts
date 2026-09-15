import {
  currentBudgetMonth,
  nextBudgetMonth,
  previousBudgetMonth,
} from "@/lib/ledger";

/**
 * "month" | "3m" | "6m" | "year" | "all" | "y<YYYY>" (an arbitrary past year,
 * e.g. "y2024"). Kept as a plain string (not a union) so it round-trips
 * through URL search params without extra parsing.
 */
export type PeriodKey = string;

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

  // Unrecognized key (e.g. a stale/tampered URL) — fall back to this month.
  return { from: today, to: nextBudgetMonth(today), label: "This Month" };
}
