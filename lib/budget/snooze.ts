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
  return {
    ...data,
    groups: data.groups.map((group) => {
      if (entityType === "group") {
        return group.id === id && group.target
          ? { ...group, target: { ...group.target, snoozedMonth: month } }
          : group;
      }
      return {
        ...group,
        categories: group.categories.map((cat) =>
          cat.id === id && cat.target
            ? { ...cat, target: { ...cat.target, snoozedMonth: month } }
            : cat,
        ),
      };
    }),
  };
}
