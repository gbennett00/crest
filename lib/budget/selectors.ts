// Pure selectors over computed BudgetData — used by the home screen to derive
// its "Overspent" and "Pinned" sections. Deriving these from BudgetData (rather
// than re-querying) keeps the home and budget screens in lockstep: whatever the
// budget screen shows as available is exactly what these report.

import type { BudgetData, BudgetViewItem } from "./types";

/**
 * Flatten BudgetData into one item per budget line: a whole group in
 * group-budgeting mode, or each visible category in category mode. Hidden and
 * Ready-to-Assign rows are excluded.
 */
export function selectBudgetItems(data: BudgetData): BudgetViewItem[] {
  const items: BudgetViewItem[] = [];

  for (const group of data.groups) {
    if (group.budgetMode === "group") {
      items.push({
        id: group.id,
        name: group.name,
        groupId: group.id,
        groupName: group.name,
        availableCents: group.groupAvailableCents,
        isPinned: group.isPinned,
        isGroup: true,
      });
    } else {
      for (const cat of group.categories) {
        if (cat.isHidden || cat.role === "ready_to_assign") continue;
        items.push({
          id: cat.id,
          name: cat.name,
          groupId: group.id,
          groupName: group.name,
          availableCents: cat.availableCents,
          isPinned: cat.isPinned || group.isPinned,
          isGroup: false,
        });
      }
    }
  }

  return items;
}

/** Overspent budget lines (negative available), most-overspent first. */
export function selectOverspent(data: BudgetData): BudgetViewItem[] {
  return selectBudgetItems(data)
    .filter((item) => item.availableCents < 0)
    .sort((a, b) => a.availableCents - b.availableCents);
}

/** Pinned budget lines, sorted by group then name. */
export function selectPinned(data: BudgetData): BudgetViewItem[] {
  return selectBudgetItems(data)
    .filter((item) => item.isPinned)
    .sort(
      (a, b) =>
        a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name),
    );
}
