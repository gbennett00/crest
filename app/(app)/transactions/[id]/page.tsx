"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { useTransactionDetail } from "@/lib/queries/transaction-detail";
import { useHasMounted } from "@/lib/use-has-mounted";

export default function EditTransactionPage() {
  return (
    <Suspense fallback={<EditTransactionSkeleton />}>
      <EditTransactionContent />
    </Suspense>
  );
}

function EditTransactionContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const backHref = searchParams.get("back") ?? "/accounts";
  const hasMounted = useHasMounted();

  const { data: response, isPending } = useTransactionDetail(id);

  if (!hasMounted || (isPending && !response)) {
    return <EditTransactionSkeleton />;
  }

  if (!response?.txn) {
    return (
      <div className="p-4">
        <p className="text-destructive text-sm">Transaction not found.</p>
      </div>
    );
  }

  return (
    <TransactionForm
      txn={response.txn}
      accounts={response.accounts}
      accountNameById={response.accountNameById}
      categories={response.categories}
      backHref={backHref}
    />
  );
}

function EditTransactionSkeleton() {
  return (
    <div className="animate-pulse p-4 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-12 bg-muted rounded" />
      ))}
    </div>
  );
}
