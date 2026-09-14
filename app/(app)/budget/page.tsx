import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { currentBudgetMonth } from "@/lib/ledger";
import { getBudgetView } from "@/lib/budget";
import { BudgetScreen } from "@/components/budget/budget-screen";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-form";

const BUDGET_MONTH_RE = /^\d{4}-\d{2}-01$/;

export default function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  return (
    <Suspense fallback={<BudgetSkeleton />}>
      <BudgetContent searchParams={searchParams} />
    </Suspense>
  );
}

async function BudgetContent({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: rawMonth } = await searchParams;
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

  return <BudgetScreen data={data} accounts={accounts} categories={categories} />;
}

function BudgetSkeleton() {
  return (
    <div className="animate-pulse p-4 space-y-3">
      <div className="h-11 bg-muted rounded" />
      <div className="h-20 bg-muted rounded-lg" />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 bg-muted rounded" />
        ))}
      </div>
    </div>
  );
}
