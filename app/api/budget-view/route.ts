import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentBudgetMonth } from "@/lib/ledger";
import { getBudgetView } from "@/lib/budget";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-form";

const BUDGET_MONTH_RE = /^\d{4}-\d{2}-01$/;

// Same query the budget page's Server Component runs, exposed as JSON so the
// client-side query cache (see lib/queries/budget.ts) can fetch a month
// on-demand — for cache misses, background revalidation, and the prefetch of
// neighbouring months — without a full RSC round-trip.
export async function GET(request: NextRequest) {
  const rawMonth = request.nextUrl.searchParams.get("month") ?? undefined;
  const month = BUDGET_MONTH_RE.test(rawMonth ?? "") ? rawMonth! : currentBudgetMonth();

  const supabase = await createClient();
  const [data, accountsRes, categoriesRes] = await Promise.all([
    getBudgetView(month),
    supabase.from("accounts").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("categories")
      .select("id, name, role, is_hidden, category_groups!group_id(name)")
      .eq("is_hidden", false)
      .order("name"),
  ]);

  const accounts: AccountOption[] = (accountsRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories: CategoryOption[] = (categoriesRes.data ?? []).map((c: any) => ({
    id: c.id as string,
    name: c.role === "ready_to_assign" ? "Ready to Assign" : (c.name as string),
    groupName: c.role === "ready_to_assign" ? "— Inflows —" : (((c.category_groups as { name: string } | null)?.name) ?? "Other"),
  })).sort((a: CategoryOption, b: CategoryOption) => {
    if (a.groupName === "— Inflows —") return -1;
    if (b.groupName === "— Inflows —") return 1;
    return 0;
  });

  return NextResponse.json({ data, accounts, categories });
}
