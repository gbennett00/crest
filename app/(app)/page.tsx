"use client";

import Link from "next/link";
import { Money } from "@/components/money";
import { PendingApprovalList } from "@/components/home/pending-approval-list";
import { HomeAddTransaction } from "@/components/home/home-add-transaction";
import { HomeAssignButton } from "@/components/home/home-assign-button";
import { PinManager } from "@/components/home/pin-manager";
import { OverspentSection } from "@/components/home/overspent-section";
import { cn } from "@/lib/utils";
import { useHomeView } from "@/lib/queries/home";
import { useHasMounted } from "@/lib/use-has-mounted";

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
  const { data: response, isPending } = useHomeView();

  if (!hasMounted || (isPending && !response)) {
    return <HomeSkeleton />;
  }

  const { budgetData, overspent, pinned, pending, accounts, categories } = response!;
  const rtaAvailableCents = budgetData.rtaAvailableCents;

  const hasItems = pending.length > 0 || overspent.length > 0 || rtaAvailableCents !== 0;
  const showRtaRow = rtaAvailableCents !== 0;
  const showPendingRow = pending.length > 0;

  return (
    <div className="p-4 space-y-5">
      {/* Page title */}
      <h1 className="text-2xl font-bold tracking-tight">Your Plan</h1>

      {/* Action card */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-2">
          <p className="text-base font-semibold">
            {hasItems ? "A few things to do" : "Lookin’ good!"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasItems ? "Take care of these when you get a chance" : "You’re all caught up"}
          </p>
        </div>

        {/* Row 1: Pending transactions — only shown when there are some */}
        {showPendingRow && (
          <div className="flex items-center gap-3 px-4 py-2.5 border-t">
            <span className="text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
              {pending.length}
            </span>
            <span className="flex-1 text-sm">New transactions</span>
            <Link
              href="#pending"
              className="text-xs font-semibold bg-primary text-primary-foreground px-3 py-1 rounded-full shrink-0"
            >
              Review
            </Link>
          </div>
        )}

        {/* Row 2: Ready to Assign — hidden when exactly $0 */}
        {showRtaRow && (
          <div className="flex items-center gap-3 px-4 py-2.5 border-t">
            <span
              className={cn(
                "text-xs font-bold px-2 h-6 rounded-full flex items-center shrink-0 tabular-nums",
                rtaAvailableCents > 0
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              <Money cents={rtaAvailableCents} />
            </span>
            <span className="flex-1 text-sm">
              {rtaAvailableCents < 0 ? "Over assigned" : "Ready to assign"}
            </span>
            {rtaAvailableCents < 0 ? (
              <Link
                href="/budget"
                className="text-xs font-semibold bg-destructive text-destructive-foreground px-3 py-1 rounded-full shrink-0"
              >
                Fix
              </Link>
            ) : (
              <HomeAssignButton data={budgetData} />
            )}
          </div>
        )}
      </div>

      {/* Overspent */}
      {overspent.length > 0 && (
        <Section title="Overspent" count={overspent.length} accent="red">
          <OverspentSection data={budgetData} items={overspent} />
        </Section>
      )}

      {/* Pending approval */}
      {pending.length > 0 && (
        <Section
          id="pending"
          title="Needs Approval"
          count={pending.length}
          accent="amber"
        >
          <PendingApprovalList
            pending={pending}
            categories={categories}
            accounts={accounts}
          />
        </Section>
      )}

      {/* Pinned categories — always shown so the pin manager is reachable */}
      <div className="border rounded-xl overflow-hidden bg-card">
        <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Pinned</h2>
            {pinned.length > 0 && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {pinned.length}
              </span>
            )}
          </div>
          <PinManager data={budgetData} />
        </div>
        {pinned.length > 0 ? (
          <div className="divide-y">
            {pinned.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.isGroup ? "Group budget" : item.groupName}
                  </p>
                </div>
                <span
                  className={cn(
                    "text-xs font-semibold tabular-nums px-2.5 py-1 rounded-full",
                    item.availableCents < 0
                      ? "bg-destructive/10 text-destructive"
                      : item.availableCents === 0
                        ? "bg-muted text-muted-foreground"
                        : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
                  )}
                >
                  <Money cents={item.availableCents} />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            No pinned categories yet. Tap “Manage” to add some.
          </p>
        )}
      </div>

      {/* Floating Add Transaction button */}
      <HomeAddTransaction accounts={accounts} categories={categories} />
    </div>
  );
}

function Section({
  id,
  title,
  count,
  accent,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  accent?: "amber" | "red";
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="border rounded-xl overflow-hidden bg-card">
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 border-b",
          accent === "amber" && "bg-amber-50 dark:bg-amber-950/20",
          accent === "red" && "bg-destructive/5",
        )}
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        {count !== undefined && (
          <span
            className={cn(
              "text-xs font-medium px-1.5 py-0.5 rounded-full",
              accent === "amber" &&
                "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
              accent === "red" && "bg-destructive/10 text-destructive",
              !accent && "bg-muted text-muted-foreground",
            )}
          >
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="p-4 animate-pulse space-y-5">
      <div className="h-8 bg-muted rounded w-1/3" />
      <div className="h-28 bg-muted rounded-xl" />
      {[1, 2].map((i) => (
        <div key={i} className="h-24 bg-muted rounded-xl" />
      ))}
    </div>
  );
}
