// Shared "funding unit" list used by budget popups that let a user move money
// between categories/groups (AssignPopup, CoverOverspendingPopup). A funding
// unit is either a category in a category-budgeted group, or a whole group in
// a group-budgeted group (member categories of a group-budgeted group are not
// funding units — see lib/budget/compute.ts).

import type { BudgetData, TargetData } from "./types";

export type EntryKey = string; // `c:${categoryId}` or `g:${groupId}`

export type BudgetEntry = {
  key: EntryKey;
  type: "category" | "group";
  id: string;
  name: string;
  groupName: string;
  originalAssigned: number;
  currentAvailable: number;
  target: TargetData | null;
};

export function buildBudgetEntries(data: BudgetData): BudgetEntry[] {
  const entries: BudgetEntry[] = [];
  for (const group of data.groups) {
    if (group.budgetMode === "group") {
      entries.push({
        key: `g:${group.id}`,
        type: "group",
        id: group.id,
        name: group.name,
        groupName: "Group budget",
        originalAssigned: group.groupAssignedCents,
        currentAvailable: group.groupAvailableCents,
        target: group.target,
      });
    } else {
      for (const cat of group.categories) {
        if (cat.role === "ready_to_assign" || cat.isHidden) continue;
        entries.push({
          key: `c:${cat.id}`,
          type: "category",
          id: cat.id,
          name: cat.name,
          groupName: group.name,
          originalAssigned: cat.assignedCents,
          currentAvailable: cat.availableCents,
          target: cat.target,
        });
      }
    }
  }
  return entries;
}
