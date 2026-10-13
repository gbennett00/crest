export type PillState = "pos" | "warn" | "neg" | "zero";

/**
 * State of an Available pill from the amount left. `underfunded` (the
 * category has money but is short of its target) turns a funded balance into
 * a warning; it never overrides overspent or zero.
 */
export function availablePillState(
  cents: number,
  opts: { underfunded?: boolean } = {},
): PillState {
  if (cents < 0) return "neg";
  if (cents === 0) return "zero";
  return opts.underfunded ? "warn" : "pos";
}
