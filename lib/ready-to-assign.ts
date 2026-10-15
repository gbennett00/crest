export type ReadyToAssignState = "assign" | "done" | "over";

/** Banner state from the Ready to Assign balance in cents. */
export function readyToAssignState(cents: number): ReadyToAssignState {
  if (cents > 0) return "assign";
  if (cents < 0) return "over";
  return "done";
}
