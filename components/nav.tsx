"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart2, Home, Landmark, PieChart, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { AddTransaction } from "@/components/add-transaction";
import { currentBudgetMonth } from "@/lib/ledger";
import { prefetchHomeView } from "@/lib/queries/home";
import { prefetchBudgetView } from "@/lib/queries/budget";
import { prefetchAccountsList, preloadAccountRegisters } from "@/lib/queries/accounts";
import {
  prefetchAllTransactions,
  preloadMonthTransactions,
  preloadRecentTransactionDetails,
} from "@/lib/queries/transactions";
import { prefetchReportsDashboard, prefetchSpendingReport } from "@/lib/queries/reports";
import { prefetchRules } from "@/lib/queries/rules";
import { prefetchMembers } from "@/lib/queries/members";
import { preloadWhenIdle } from "@/lib/queries/preload";
import { DEFAULT_PERIOD_KEY } from "@/lib/reports/period";

const NAV_LINKS = [
  { href: "/", label: "Home", Icon: Home, exact: true },
  { href: "/budget", label: "Plan", Icon: BarChart2, exact: false },
  { href: "/transactions", label: "Activity", Icon: Receipt, exact: false },
  { href: "/accounts", label: "Accounts", Icon: Landmark, exact: false },
  { href: "/reports", label: "Reports", Icon: PieChart, exact: false },
] as const;

// Reached from a tab or the user menu rather than the nav itself.
const SECONDARY_ROUTES = ["/reports/spending", "/rules", "/members"] as const;

// Warm both Next's Router Cache (the route's JS/shell) and the client query
// cache (the route's actual data — see lib/queries/*) for the top-level tabs
// on mount, so switching tabs is instant even on the very first tap, not just
// on a revisit. Both calls are idempotent/deduped against already-fresh
// cache entries, so calling this from whichever nav is mounted (sidebar on
// desktop, bottom nav on mobile) is harmless.
let secondaryPreloadQueued = false;

function useEagerPrefetch() {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    for (const { href } of NAV_LINKS) router.prefetch(href);
    prefetchHomeView(queryClient);
    prefetchBudgetView(queryClient, currentBudgetMonth());
    prefetchAccountsList(queryClient);
    prefetchAllTransactions(queryClient, {});
    prefetchReportsDashboard(queryClient);

    // Both navs mount this hook (one is hidden by CSS); queue once per load.
    if (secondaryPreloadQueued) return;
    secondaryPreloadQueued = true;

    // Then, one at a time while the browser is idle, the screens a tab leads
    // to (lib/queries/preload.ts), most used first: this month's transactions
    // (every category drill-down on the Plan tab), every account's register,
    // the Activity tab's first edit pages, and the less used pages.
    preloadMonthTransactions(queryClient, currentBudgetMonth());
    preloadAccountRegisters(queryClient);
    preloadRecentTransactionDetails(queryClient);
    for (const href of SECONDARY_ROUTES) router.prefetch(href);
    preloadWhenIdle(
      () => prefetchSpendingReport(queryClient, DEFAULT_PERIOD_KEY, [], null),
      () => prefetchRules(queryClient),
      () => prefetchMembers(queryClient),
    );
  }, [router, queryClient]);
}

export function BottomNav() {
  const pathname = usePathname();
  useEagerPrefetch();
  return (
    <>
      {/* Floating dock: a five-tab capsule, with the round Add button beside it. */}
      <nav
        aria-label="Main"
        className="fixed bottom-[var(--dock-bottom)] left-dock-inset right-[76px] z-30 flex h-[72px] gap-0 rounded-ds-xl border bg-surface-raised p-1.5 shadow-float md:hidden"
      >
        {NAV_LINKS.map(({ href, label, Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-ds-lg text-[12px] font-semibold leading-4 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                active ? "bg-brand-subtle text-brand-text" : "text-ink-muted",
              )}
            >
              <Icon size={24} strokeWidth={active ? 2 : 1.75} />
              {label}
            </Link>
          );
        })}
      </nav>
      <AddTransaction />
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  useEagerPrefetch();
  return (
    <aside className="hidden md:flex flex-col w-48 border-r py-3 px-2 gap-1 shrink-0">
      {NAV_LINKS.map(({ href, label, Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <Icon size={16} />
            {label}
          </Link>
        );
      })}
    </aside>
  );
}
