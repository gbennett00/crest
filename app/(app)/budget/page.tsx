import { Suspense } from "react";
import { currentBudgetMonth } from "@/lib/ledger";
import { getBudgetView } from "@/lib/budget";
import { BudgetScreen } from "@/components/budget/budget-screen";

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

  const data = await getBudgetView(month);
  return <BudgetScreen data={data} />;
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
