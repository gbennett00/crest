"use client";

import { AccountCard } from "@/components/accounts/account-card";
import { AddAccountForm } from "@/components/accounts/add-account-form";
import { LinkAccountButton } from "@/components/accounts/link-account-button";
import { ClosedAccountsSection } from "@/components/accounts/closed-accounts-section";
import type { AccountData } from "@/components/accounts/account-card";
import { Money } from "@/components/money";
import { cn } from "@/lib/utils";
import { useAccountsList } from "@/lib/queries/accounts";
import { useHasMounted } from "@/lib/use-has-mounted";
import { TRACKING_ACCOUNT_TYPES } from "@/lib/ledger/types";

// No server-side data fetch here on purpose — see app/(app)/budget/page.tsx
// for why. AccountsContent owns its data through the client query cache
// (lib/queries/accounts.ts), so a revisit renders straight from cache.
export default function AccountsPage() {
  return (
    <div className="max-w-2xl p-4 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
        <div className="flex items-center gap-1">
          <AddAccountForm iconOnly />
          <LinkAccountButton iconOnly />
        </div>
      </div>
      <AccountsContent />
    </div>
  );
}

function AccountsContent() {
  const hasMounted = useHasMounted();
  const { data: response, isPending } = useAccountsList();

  if (!hasMounted || (isPending && !response)) {
    return <AccountsSkeleton />;
  }

  const accounts: AccountData[] = response?.accounts ?? [];

  const activeAccounts = accounts.filter((a) => a.isActive);
  const closedAccounts = accounts.filter((a) => !a.isActive);

  const cashAccounts = activeAccounts.filter((a) => a.type === "checking" || a.type === "savings");
  const creditAccounts = activeAccounts.filter((a) => a.type === "credit");
  const trackingAccounts = activeAccounts.filter((a) =>
    (TRACKING_ACCOUNT_TYPES as readonly string[]).includes(a.type),
  );

  const cashTotal = cashAccounts.reduce((s, a) => s + a.workingBalanceCents, 0);
  const creditTotal = creditAccounts.reduce((s, a) => s + a.workingBalanceCents, 0);
  const trackingTotal = trackingAccounts.reduce((s, a) => s + a.workingBalanceCents, 0);

  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No accounts yet. Use the buttons above to add one or link a bank account.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Cash accounts */}
      {cashAccounts.length > 0 && (
        <AccountGroup title="Cash" total={cashTotal} accounts={cashAccounts} />
      )}

      {/* Credit accounts */}
      {creditAccounts.length > 0 && (
        <AccountGroup title="Credit" total={creditTotal} accounts={creditAccounts} />
      )}

      {/* Tracking accounts — net worth only, never the budget */}
      {trackingAccounts.length > 0 && (
        <AccountGroup title="Tracking" total={trackingTotal} accounts={trackingAccounts} />
      )}

      {/* Closed accounts (collapsed, at the very bottom) */}
      <ClosedAccountsSection accounts={closedAccounts} />
    </div>
  );
}

function AccountGroup({
  title,
  total,
  accounts,
}: {
  title: string;
  total: number;
  accounts: AccountData[];
}) {
  return (
    <div className="border rounded-xl overflow-hidden bg-card">
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            total < 0 ? "text-destructive" : "",
          )}
        >
          <Money cents={total} />
        </span>
      </div>
      <div className="divide-y">
        {accounts.map((account) => (
          <AccountCard key={account.id} account={account} />
        ))}
      </div>
    </div>
  );
}

function AccountsSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-24 bg-muted rounded-xl" />
      ))}
    </div>
  );
}
