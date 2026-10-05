import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadCategoryOptions } from "@/lib/budget";
import { getActivePlanId } from "@/lib/plan/active-plan";
import { listCategoryRules, type CategoryRule } from "@/lib/category-rules";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-form";

export type RuleListRow = CategoryRule & {
  categoryName: string;
  /** The category is hidden (archived): the rule is kept but skipped. */
  categoryHidden: boolean;
  accountName: string | null;
};

export type RulesResponse = {
  rules: RuleListRow[];
  categories: CategoryOption[];
  accounts: AccountOption[];
};

export async function GET() {
  const supabase = await createClient();

  try {
    const planId = await getActivePlanId(supabase);
    const [rules, categories, categoriesRes, accountsRes] = await Promise.all([
      listCategoryRules(supabase, planId),
      loadCategoryOptions(supabase),
      // Names for every category a rule may point at, hidden ones included —
      // the picker options above leave hidden categories out.
      supabase.from("categories").select("id, name, role, is_hidden"),
      supabase.from("accounts").select("id, name, is_active, on_budget").order("name"),
    ]);
    if (categoriesRes.error) throw new Error(categoriesRes.error.message);
    if (accountsRes.error) throw new Error(accountsRes.error.message);

    const categoryById = new Map(
      (
        categoriesRes.data as { id: string; name: string; role: string | null; is_hidden: boolean }[]
      ).map((c) => [c.id, c]),
    );
    const allAccounts = accountsRes.data as {
      id: string;
      name: string;
      is_active: boolean;
      on_budget: boolean;
    }[];
    const accountName = new Map(allAccounts.map((a) => [a.id, a.name]));

    const response: RulesResponse = {
      rules: rules.map((rule) => {
        const cat = categoryById.get(rule.categoryId);
        return {
          ...rule,
          categoryName:
            cat?.role === "ready_to_assign" ? "Ready to Assign" : (cat?.name ?? "Unknown"),
          categoryHidden: cat?.is_hidden ?? false,
          accountName: rule.accountId ? (accountName.get(rule.accountId) ?? "Unknown") : null,
        };
      }),
      categories,
      // Rules only ever apply to on-budget accounts.
      accounts: allAccounts
        .filter((a) => a.is_active && a.on_budget)
        .map((a) => ({ id: a.id, name: a.name, onBudget: true })),
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load rules" }, { status: 500 });
  }
}
