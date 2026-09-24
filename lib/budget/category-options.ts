import type { SupabaseClient } from "@supabase/supabase-js";
import type { CategoryOption } from "@/components/transactions/transaction-form";

type RawOptionCategory = {
  id: string;
  name: string;
  role: "ready_to_assign" | null;
  is_hidden: boolean;
  sort_index: number;
};

type RawOptionGroup = {
  id: string;
  name: string;
  sort_index: number;
  categories: RawOptionCategory[] | null;
};

/**
 * Category options for every picker in the app (transaction category select,
 * bulk categorize/approve, the approve-transaction form, …), in the same
 * order categories are shown on the Plan screen: groups by `sort_index`, then
 * categories within a group by `sort_index`.
 *
 * Ready to Assign is pulled out into a synthetic "— Inflows —" group and
 * always listed first — it's presented as an inflow target, not a spending
 * category, so it doesn't belong in its real group's position in the list.
 */
export async function loadCategoryOptions(
  client: SupabaseClient,
): Promise<CategoryOption[]> {
  const { data } = await client
    .from("category_groups")
    .select("id, name, sort_index, categories(id, name, role, is_hidden, sort_index)")
    .order("sort_index")
    .order("sort_index", { referencedTable: "categories" });

  const groups = (data ?? []) as unknown as RawOptionGroup[];

  const inflows: CategoryOption[] = [];
  const options: CategoryOption[] = [];

  for (const group of groups) {
    for (const c of group.categories ?? []) {
      if (c.is_hidden) continue;
      if (c.role === "ready_to_assign") {
        inflows.push({ id: c.id, name: "Ready to Assign", groupName: "— Inflows —" });
        continue;
      }
      options.push({ id: c.id, name: c.name, groupName: group.name });
    }
  }

  return [...inflows, ...options];
}
