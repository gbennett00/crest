// Options and validation for the "Move money" dialog: moving assigned money
// between any two funding units (see ./entries) or Ready to Assign, recorded
// as a single budget move (lib/ledger moveMoney).

import { READY_TO_ASSIGN, type BudgetMoveInput, type BudgetUnit } from "@/lib/ledger";
import { buildBudgetEntries, type EntryKey } from "./entries";
import type { BudgetData } from "./types";

export const RTA_MOVE_KEY: EntryKey = "rta";

export type MoveOption = {
  /** Entry key: `c:${categoryId}`, `g:${groupId}`, or RTA_MOVE_KEY. */
  id: EntryKey;
  name: string;
  groupName: string;
  availableCents: number;
};

/** Ready to Assign first, then every funding unit in Plan order. */
export function buildMoveOptions(data: BudgetData): MoveOption[] {
  return [
    {
      id: RTA_MOVE_KEY,
      name: "Ready to Assign",
      groupName: "— Ready to Assign —",
      availableCents: data.rtaAvailableCents,
    },
    ...buildBudgetEntries(data).map((e) => ({
      id: e.key,
      name: e.name,
      groupName: e.groupName,
      availableCents: e.currentAvailable,
    })),
  ];
}

export function unitKey(unit: BudgetUnit): EntryKey {
  return unit.type === "category" ? `c:${unit.id}` : `g:${unit.id}`;
}

function keyToSide(key: EntryKey): BudgetUnit | typeof READY_TO_ASSIGN {
  if (key === RTA_MOVE_KEY) return READY_TO_ASSIGN;
  const id = key.slice(2);
  return key.startsWith("g:") ? { type: "group", id } : { type: "category", id };
}

export type MoveMoneyDraft = {
  month: string;
  fromKey: EntryKey | null;
  toKey: EntryKey | null;
  amountCents: number;
};

/** The move to record, or why the draft can't be saved yet. */
export function resolveMoveMoney(
  draft: MoveMoneyDraft,
): { move: BudgetMoveInput } | { error: string } {
  if (!draft.fromKey || !draft.toKey) return { error: "Choose where to move money from and to." };
  if (draft.fromKey === draft.toKey) return { error: "Choose two different categories." };
  if (!Number.isInteger(draft.amountCents) || draft.amountCents <= 0) {
    return { error: "Enter an amount to move." };
  }
  return {
    move: {
      month: draft.month,
      from: keyToSide(draft.fromKey),
      to: keyToSide(draft.toKey),
      amountCents: draft.amountCents,
    },
  };
}
