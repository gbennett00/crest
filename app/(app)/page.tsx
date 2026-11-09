"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AvailablePill } from "@/components/ui/available-pill";
import { PendingApprovalList } from "@/components/home/pending-approval-list";
import { HomeAssignButton } from "@/components/home/home-assign-button";
import { PinManager } from "@/components/home/pin-manager";
import { OverspentSection } from "@/components/home/overspent-section";
import { CountBadge, HomeCard, HomeCategoryRow } from "@/components/home/home-card";
import { useHomeView } from "@/lib/queries/home";
import { useHasMounted } from "@/lib/use-has-mounted";
import { useScreenTiming } from "@/lib/use-perf";
import { LoadError } from "@/components/load-error";

// No server-side data fetch here on purpose — see app/(app)/budget/page.tsx
// for why. HomeContent owns its data through the client query cache
// (lib/queries/home.ts), so a revisit renders straight from cache.
export default function HomePage() {
  return (
    <div className="max-w-2xl">
      <HomeContent />
    </div>
  );
}

function HomeContent() {
  const hasMounted = useHasMounted();
  const { data: response, isPending, isFetching, error, refetch } = useHomeView();
  useScreenTiming("home", { hasData: hasMounted && !!response, isFetching });

  if (hasMounted && !response && error) {
    return <LoadError what="plan" error={error} onRetry={() => refetch()} />;
  }
  if (!hasMounted || (isPending && !response)) {
    return <HomeSkeleton />;
  }

  const { budgetData, overspent, pinned, pending, accounts, categories } = response!;
  const rtaAvailableCents = budgetData.rtaAvailableCents;

  const showPendingRow = pending.length > 0;
  const showRtaRow = rtaAvailableCents !== 0;
  const hasItems = showPendingRow || overspent.length > 0 || showRtaRow;
  const todoCount = (showPendingRow ? 1 : 0) + (showRtaRow ? 1 : 0) + (overspent.length > 0 ? 1 : 0);

  return (
    <div className="space-y-6 p-4 text-ink">
      <h1 className="text-title-lg">Home</h1>

      {/* To-do card: value first in every row. */}
      <HomeCard
        title={
          !hasItems ? "You’re all caught up" : todoCount === 1 ? "Just one thing to do" : "A few things to do"
        }
        subtitle={hasItems ? "Take care of these when you get a chance" : "Nothing needs you right now"}
      >
        {(showPendingRow || showRtaRow) && (
          <ul className="divide-y">
            {showPendingRow && (
              <li className="flex min-h-row-list items-center gap-3 px-4 py-2.5">
                <CountBadge tone="warn" count={pending.length} />
                <span className="flex-1 text-body text-ink">
                  New {pending.length === 1 ? "transaction" : "transactions"}
                </span>
                <Button asChild variant="secondary" size="sm" className="shrink-0">
                  <a href="#pending">Review</a>
                </Button>
              </li>
            )}
            {showRtaRow && (
              <li className="flex min-h-row-list items-center gap-3 px-4 py-2.5">
                <AvailablePill cents={rtaAvailableCents} />
                <span className="min-w-0 flex-1 truncate text-body text-ink">
                  {rtaAvailableCents < 0 ? "Over assigned" : "Ready to assign"}
                </span>
                {rtaAvailableCents < 0 ? (
                  <Button asChild variant="destructive" size="sm" className="shrink-0">
                    <Link href="/budget">Fix</Link>
                  </Button>
                ) : (
                  <HomeAssignButton data={budgetData} />
                )}
              </li>
            )}
          </ul>
        )}
      </HomeCard>

      {overspent.length > 0 && (
        <HomeCard
          title="Overspent"
          badge={<CountBadge tone="neg" count={overspent.length} />}
          subtitle="Tap an amount to cover it"
        >
          <OverspentSection data={budgetData} items={overspent} />
        </HomeCard>
      )}

      {pending.length > 0 && (
        <PendingApprovalList pending={pending} categories={categories} accounts={accounts} />
      )}

      {/* Pinned — always shown so the pin manager is reachable. */}
      <HomeCard
        title="Pinned"
        badge={pinned.length > 0 ? <CountBadge count={pinned.length} /> : undefined}
        action={<PinManager data={budgetData} />}
      >
        {pinned.length > 0 ? (
          <ul className="divide-y">
            {pinned.map((item) => (
              <li key={item.id}>
                <HomeCategoryRow
                  name={item.name}
                  groupName={item.isGroup ? "Group budget" : item.groupName}
                  trailing={<AvailablePill cents={item.availableCents} className="shrink-0" />}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-caption text-ink-muted">
            No pinned categories yet. Tap Manage to add some.
          </p>
        )}
      </HomeCard>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="animate-pulse space-y-6 p-4" aria-busy="true" aria-label="Loading">
      <div className="h-9 w-1/3 rounded-ds-sm bg-surface-sunken" />
      <div className="h-36 rounded-ds-lg bg-surface-sunken" />
      {[1, 2].map((i) => (
        <div key={i} className="h-28 rounded-ds-lg bg-surface-sunken" />
      ))}
    </div>
  );
}
