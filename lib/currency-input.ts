// Pure helpers behind CurrencyInput's digit-shift behavior (components/ui/currency-input.tsx),
// split out so the cents arithmetic can be unit tested without a DOM.

// A cap well above any real-world dollar amount, so a runaway paste can't
// push the value past Number's safe integer range.
export const MAX_MAGNITUDE_CENTS = 999_999_999_999; // $9,999,999,999.99

/**
 * Re-derives the signed cents value from whatever digit characters are
 * currently in the field (non-digit characters — "$", ",", ".", a stray
 * "-" — are ignored) and the field's separately-tracked sign. The field's
 * entire digit string is always reinterpreted as the value, which is what
 * makes typing a digit equivalent to `cents = cents * 10 + digit` and
 * Backspace equivalent to `cents = Math.floor(cents / 10)`, as long as the
 * cursor never leaves the end of the field.
 */
export function centsFromDigits(rawValue: string, sign: 1 | -1): number {
  const digitsOnly = rawValue.replace(/[^0-9]/g, "");
  let magnitude = digitsOnly === "" ? 0 : parseInt(digitsOnly, 10);
  if (!Number.isFinite(magnitude)) magnitude = 0;
  magnitude = Math.min(magnitude, MAX_MAGNITUDE_CENTS);
  return magnitude === 0 ? 0 : sign * magnitude;
}

/** Formats cents as a plain "-123.45"-style decimal string (no currency symbol). */
export function formatCentsInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Resolves what an AssignmentAmountEditor session should commit, given the
 * accumulated absolute/delta state at blur/Enter (components/ui/assignment-amount-input.tsx).
 * Returns `null` when nothing was typed — the caller should leave the
 * original value alone rather than overwrite it with a no-op edit.
 */
export function resolveAssignmentCommit(params: {
  touched: boolean;
  mode: "absolute" | "delta";
  original: number;
  absoluteCents: number;
  deltaSign: 1 | -1;
  deltaCents: number;
}): number | null {
  if (!params.touched) return null;
  return params.mode === "absolute"
    ? params.absoluteCents
    : params.original + params.deltaSign * params.deltaCents;
}
