"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart2, Home, Landmark, PieChart, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { currentBudgetMonth } from "@/lib/ledger";
import { prefetchHomeView } from "@/lib/queries/home";
import { prefetchBudgetView } from "@/lib/queries/budget";
import { prefetchAccountsList } from "@/lib/queries/accounts";
import { prefetchAllTransactions } from "@/lib/queries/transactions";

const NAV_LINKS = [
  { href: "/", label: "Home", Icon: Home, exact: true },
  { href: "/budget", label: "Plan", Icon: BarChart2, exact: false },
  { href: "/accounts", label: "Accounts", Icon: Landmark, exact: false },
  { href: "/transactions", label: "Transactions", Icon: Receipt, exact: false },
  { href: "/reports", label: "Reports", Icon: PieChart, exact: false },
] as const;

// Warm both Next's Router Cache (the route's JS/shell) and the client query
// cache (the route's actual data — see lib/queries/*) for the top-level tabs
// on mount, so switching tabs is instant even on the very first tap, not just
// on a revisit. Both calls are idempotent/deduped against already-fresh
// cache entries, so calling this from whichever nav is mounted (sidebar on
// desktop, bottom nav on mobile) is harmless.
function useEagerPrefetch() {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    for (const { href } of NAV_LINKS) router.prefetch(href);
    prefetchHomeView(queryClient);
    prefetchBudgetView(queryClient, currentBudgetMonth());
    prefetchAccountsList(queryClient);
    prefetchAllTransactions(queryClient, {});
  }, [router, queryClient]);
}

export function BottomNav() {
  const pathname = usePathname();
  useEagerPrefetch();
  return (
    <nav className="fixed bottom-0 inset-x-0 min-h-16 border-t bg-background flex md:hidden z-20 pb-[env(safe-area-inset-bottom)]">
      {NAV_LINKS.map(({ href, label, Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-1 pt-2.5 pb-1.5 text-xs font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon size={20} />
            {label}
          </Link>
        );
      })}
    </nav>
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
