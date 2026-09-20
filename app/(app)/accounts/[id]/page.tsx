"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { AccountDetailHeader } from "@/components/accounts/account-detail-header";
import { AccountBalanceSummary } from "@/components/accounts/account-balance-summary";
import { AccountAddTransaction } from "@/components/accounts/account-add-transaction";
import { RegisterTransactionList } from "@/components/accounts/register-transaction-list";
import { useAccountRegister } from "@/lib/queries/accounts";
import { useHasMounted } from "@/lib/use-has-mounted";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// No server-side data fetch here on purpose — see app/(app)/budget/page.tsx
// for why. RegisterContent owns its data through the client query cache
// (lib/queries/accounts.ts), so coming back to an account you were just
// looking at renders straight from cache instead of re-fetching.
export default function AccountRegisterPage() {
  return (
    <Suspense fallback={<RegisterSkeleton />}>
      <RegisterContent />
    </Suspense>
  );
}

function RegisterContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const categoryFilter = searchParams.get("category") ?? undefined;
  const monthFilter = searchParams.get("month") ?? undefined;
  const hasMounted = useHasMounted();

  const { data: response, isPending } = useAccountRegister(id, categoryFilter, monthFilter);

  if (!hasMounted || (isPending && !response)) {
    return <RegisterSkeleton />;
  }

  if (!response?.found || !response.account) {
    return (
      <div className="p-4">
        <p className="text-destructive text-sm">Account not found.</p>
      </div>
    );
  }

  const { account } = response;
  const subtitle = monthFilter
    ? `${MONTH_NAMES[+monthFilter.slice(5, 7) - 1]} ${monthFilter.slice(0, 4)}`
    : "All transactions";

  return (
    <div className="max-w-2xl">
      <AccountDetailHeader
        accountId={id}
        accountName={response.categoryName ? `${response.categoryName} — ${account.name}` : account.name}
        registerClearedBalanceCents={response.registerClearedBalanceCents}
        isLinked={account.isLinked}
        bankBalanceCents={account.bankBalanceCents}
        backHref="/accounts"
        isActive={account.isActive}
        canClose={response.canClose}
        closeBlockReason={response.closeBlockReason}
      />

      {/* Balance summary */}
      <AccountBalanceSummary
        subtitle={subtitle}
        workingBalanceCents={response.workingCents}
        clearedCents={response.registerClearedBalanceCents}
        unclearedCents={response.unclearedCents}
      />

      {response.txns.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-16">No transactions.</p>
      ) : (
        <RegisterTransactionList
          accountId={id}
          transactions={response.txns}
          categories={response.categoryOptions}
          accounts={response.accountOptions}
        />
      )}

      <AccountAddTransaction
        accountId={id}
        accounts={response.accountOptions}
        categories={response.categoryOptions}
      />
    </div>
  );
}

function RegisterSkeleton() {
  return (
    <div>
      <div className="animate-pulse p-4 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-14 bg-muted rounded" />
        ))}
      </div>
    </div>
  );
}
