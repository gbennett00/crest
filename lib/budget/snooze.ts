import type { BudgetData } from "./types";

/**
 * Returns `data` with the target on the given category/group snoozed for
 * `month` (null to unsnooze). Used to patch the cached budget view
 * optimistically; the server stays the source of truth (see useSnoozeTarget).
 * A row without a target is left alone.
 */
export function withTargetSnoozed(
  data: BudgetData,
  entityType: "category" | "group",
  id: string,
  month: string | null,
): BudgetData {
  // Only a row with a target that isn't already snoozed for `month` changes;
  // otherwise `data` itself comes back, as runOptimistic's patches require.
  const needsChange = (target: BudgetData["groups"][number]["target"]) =>
    !!target && (target.snoozedMonth ?? null) !== month;
  let changed = false;

  const groups = data.groups.map((group) => {
    if (entityType === "group") {
      if (group.id !== id || !needsChange(group.target)) return group;
      changed = true;
      return { ...group, target: { ...group.target!, snoozedMonth: month } };
    }
    if (!group.categories.some((cat) => cat.id === id && needsChange(cat.target))) return group;
    changed = true;
    return {
      ...group,
      categories: group.categories.map((cat) =>
        cat.id === id && cat.target ? { ...cat, target: { ...cat.target, snoozedMonth: month } } : cat,
      ),
    };
  });

  return changed ? { ...data, groups } : data;
}
