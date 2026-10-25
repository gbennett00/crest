"use client";

import Link from "next/link";
import { useState } from "react";
import { AvailablePill } from "@/components/ui/available-pill";
import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui/count-badge";
import { ReviewDrawer } from "@/components/home/review-drawer";
import { HomeAssignButton } from "@/components/home/home-assign-button";
import { PinManager } from "@/components/home/pin-manager";
import { OverspentSection } from "@/components/home/overspent-section";
import { splitLeadingEmoji } from "@/lib/leading-emoji";
import { useHomeView } from "@/lib/queries/home";
import { useHasMounted } from "@/lib/use-has-mounted";
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
  const { data: response, isPending, error, refetch } = useHomeView();
  const [reviewOpen, setReviewOpen] = useState(false);

  if (hasMounted && !response && error) {
    return <LoadError what="plan" error={error} onRetry={() => refetch()} />;
  }
  if (!hasMounted || (isPending && !response)) {
    return <HomeSkeleton />;
  }

  const { budgetData, overspent, pinned, pending, categories } = response!;
  const rtaAvailableCents = budgetData.rtaAvailableCents;

  const hasItems = pending.length > 0 || overspent.length > 0 || rtaAvailableCents !== 0;
  const showRtaRow = rtaAvailableCents !== 0;
  const showPendingRow = pending.length > 0;

  return (
    <div className="space-y-4 px-4 pb-4 pt-2">
      <h1 className="text-title-lg">Home</h1>

      {/* Things to do: value first, then label, then action. */}
      <section className="overflow-hidden rounded-ds-lg bg-surface pt-5">
        <div className={hasItems ? "px-4 pb-3" : "px-4 pb-5"}>
          <h2 className="text-title">{hasItems ? "A few things to do" : "Lookin’ good!"}</h2>
          <p className="text-caption text-ink-muted">
            {hasItems ? "Take care of these when you get a chance" : "You’re all caught up"}
          </p>
        </div>

        {showPendingRow && (
          <HomeRow
            value={<CountBadge>{pending.length}</CountBadge>}
            label="New transactions"
            action={
              <Button size="sm" onClick={() => setReviewOpen(true)}>
                Review
              </Button>
            }
          />
        )}

        {/* Hidden when exactly $0. */}
        {showRtaRow && (
          <HomeRow
            value={<AvailablePill cents={rtaAvailableCents} />}
            label={rtaAvailableCents < 0 ? "Over assigned" : "Ready to assign"}
            action={
              rtaAvailableCents < 0 ? (
                <Button asChild size="sm" variant="destructive">
                  <Link href="/budget">Fix</Link>
                </Button>
              ) : (
                <HomeAssignButton data={budgetData} />
              )
            }
          />
        )}
      </section>

      {overspent.length > 0 && (
        <Card title="Overspent" count={overspent.length} tone="neg">
          <OverspentSection data={budgetData} items={overspent} />
        </Card>
      )}

      {/* Pinned categories — always shown so the pin manager is reachable */}
      <section className="overflow-hidden rounded-ds-lg bg-surface">
        <div className="flex h-14 items-center justify-between bg-surface-sunken pl-4 pr-2">
          <h2 className="text-headline">Pinned</h2>
          <PinManager data={budgetData} />
        </div>
        {pinned.length > 0 ? (
          pinned.map((item) => {
            const { emoji, label } = splitLeadingEmoji(item.name);
            return (
              <div
                key={item.id}
                className="flex min-h-row-list items-center gap-3 border-t px-4 py-2 first:border-t-0"
              >
                <span aria-hidden="true" className="w-7 shrink-0 text-center text-[22px] leading-6">
                  {emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body">{label}</p>
                  <p className="truncate text-caption text-ink-muted">
                    {item.isGroup ? "Group budget" : item.groupName}
                  </p>
                </div>
                <AvailablePill cents={item.availableCents} />
              </div>
            );
          })
        ) : (
          <p className="px-4 py-6 text-center text-caption text-ink-muted">
            No pinned categories yet. Tap “Manage” to add some.
          </p>
        )}
      </section>

      <ReviewDrawer
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        pending={pending}
        categories={categories}
      />
    </div>
  );
}

function HomeRow({
  value,
  label,
  action,
}: {
  value: React.ReactNode;
  label: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex min-h-row-list items-center gap-2.5 border-t px-4 py-2">
      <span className="shrink-0">{value}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0">{action}</span>
    </div>
  );
}

function Card({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count: number;
  tone: "warn" | "neg";
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-ds-lg bg-surface">
      <div className="flex h-14 items-center gap-2 bg-surface-sunken px-4">
        <h2 className="text-headline">{title}</h2>
        <CountBadge tone={tone}>{count}</CountBadge>
      </div>
      {children}
    </section>
  );
}

function HomeSkeleton() {
  return (
    <div className="animate-pulse space-y-4 px-4 pb-4 pt-2">
      <div className="h-9 w-1/3 rounded bg-muted" />
      <div className="h-36 rounded-ds-lg bg-muted" />
      {[1, 2].map((i) => (
        <div key={i} className="h-24 rounded-ds-lg bg-muted" />
      ))}
    </div>
  );
}
