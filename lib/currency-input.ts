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

export type AssignmentEditState = {
  mode: "absolute" | "delta";
  /** The amount the delta applies to — the original, what was typed before
   * "+"/"-", or the result of the last "=" press. */
  base: number;
  absoluteSign: 1 | -1;
  absoluteCents: number; // magnitude
  deltaSign: 1 | -1;
  deltaCents: number; // magnitude
  touched: boolean;
};

export type AssignmentKey =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "+" | "-" | "=" | "backspace" | "clear";

export function initialAssignmentEditState(original: number): AssignmentEditState {
  return {
    mode: "absolute",
    base: original,
    absoluteSign: original < 0 ? -1 : 1,
    absoluteCents: Math.abs(original),
    deltaSign: 1,
    deltaCents: 0,
    touched: false,
  };
}

/**
 * One keypress on the assignment keypad (the on-screen pad on touch devices;
 * the physical +/-/digit keys follow the same rules). Digits shift in from
 * the right, "+"/"-" start (or re-sign) a delta, "=" folds the delta into the
 * amount and stays in the editor, "clear" zeroes the field being typed.
 */
export function pressAssignmentKey(
  state: AssignmentEditState,
  key: AssignmentKey,
): AssignmentEditState {
  const field = state.mode === "absolute" ? "absoluteCents" : "deltaCents";
  const next = { ...state, touched: true };

  if (key === "+" || key === "-") {
    const sign = key === "+" ? 1 : -1;
    // Leaving absolute mode folds whatever was typed into the base, so
    // "10.00" then "+" adds to $10.00 rather than to the original amount.
    return state.mode === "absolute"
      ? {
          ...next,
          mode: "delta",
          base: state.absoluteSign * state.absoluteCents,
          deltaSign: sign,
          deltaCents: 0,
        }
      : { ...next, deltaSign: sign };
  }
  if (key === "=") {
    if (state.mode === "absolute") return state;
    const result = state.base + state.deltaSign * state.deltaCents;
    return {
      ...next,
      mode: "absolute",
      base: result,
      absoluteSign: result < 0 ? -1 : 1,
      absoluteCents: Math.abs(result),
      deltaSign: 1,
      deltaCents: 0,
    };
  }
  if (key === "clear") return { ...next, [field]: 0 };
  if (key === "backspace") return { ...next, [field]: Math.floor(state[field] / 10) };
  return {
    ...next,
    [field]: Math.min(state[field] * 10 + Number(key), MAX_MAGNITUDE_CENTS),
  };
}

/** Applies a signed value from the native (desktop) CurrencyInput to the active field. */
export function setAssignmentCents(
  state: AssignmentEditState,
  cents: number,
): AssignmentEditState {
  if (state.mode === "delta") return { ...state, touched: true, deltaCents: Math.abs(cents) };
  return {
    ...state,
    touched: true,
    absoluteSign: cents < 0 ? -1 : cents > 0 ? 1 : state.absoluteSign,
    absoluteCents: Math.abs(cents),
  };
}

/** What the editor should commit right now, or null if nothing was typed. */
export function resolveAssignmentEditState(state: AssignmentEditState): number | null {
  return resolveAssignmentCommit({
    touched: state.touched,
    mode: state.mode,
    original: state.base,
    absoluteCents: state.absoluteSign * state.absoluteCents,
    deltaSign: state.deltaSign,
    deltaCents: state.deltaCents,
  });
}
