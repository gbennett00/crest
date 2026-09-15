"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BudgetScreen } from "@/components/budget/budget-screen";

const BUDGET_MONTH_RE = /^\d{4}-\d{2}-01$/;

// This page has no server-side data fetch on purpose. It used to re-run
// getBudgetView on every navigation here (including "back" from a category's
// register), which meant a page you'd just been looking at still cost a
// round-trip to reload. BudgetScreen now owns its data through the client
// query cache (lib/queries/budget.ts) — a revisit renders straight from
// cache, and only a genuinely cold cache (or a jump to an unfetched month)
// shows the skeleton below.
export default function BudgetPage() {
  return (
    <Suspense fallback={<BudgetSkeleton />}>
      <BudgetContent />
    </Suspense>
  );
}

function BudgetContent() {
  const searchParams = useSearchParams();
  const rawMonth = searchParams.get("month");
  const initialMonth = rawMonth && BUDGET_MONTH_RE.test(rawMonth) ? rawMonth : undefined;
  return <BudgetScreen initialMonth={initialMonth} />;
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
