export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Parse a dollar amount or simple +/- expression into integer cents.
 *
 * Supports a single value ("99", "99.00", ".5") or a chain of additions and
 * subtractions ("99.00+23.49", "100-5+2.50"). This lets a user append "+23.49"
 * to an existing assignment instead of doing the arithmetic themselves.
 *
 * Returns `null` when the input is empty or not a valid amount/expression.
 * Each term is rounded to cents independently so float drift can't accumulate.
 */
export function parseMoneyExpression(input: string): number | null {
  // Drop currency symbols, thousands separators, and whitespace.
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;

  // A signed first term followed by zero or more +/- terms. A decimal term is
  // digits with an optional fraction ("99", "99.") or a bare fraction (".5").
  const term = "(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
  const expression = new RegExp(`^[+-]?${term}(?:[+-]${term})*$`);
  if (!expression.test(cleaned)) return null;

  const terms = cleaned.match(new RegExp(`[+-]?${term}`, "g"));
  if (!terms) return null;

  let cents = 0;
  for (const t of terms) {
    const dollars = parseFloat(t);
    if (Number.isNaN(dollars)) return null;
    cents += Math.round(dollars * 100);
  }
  return cents;
}
