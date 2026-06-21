"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart2, Home, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Home", Icon: Home, exact: true },
  { href: "/budget", label: "Plan", Icon: BarChart2, exact: false },
  { href: "/accounts", label: "Accounts", Icon: Landmark, exact: false },
] as const;

// Warm the Router Cache for the three top-level routes on mount so switching
// tabs is instant. router.prefetch is idempotent, so calling it from whichever
// nav is mounted (sidebar on desktop, bottom nav on mobile) is harmless.
function useEagerPrefetch() {
  const router = useRouter();
  useEffect(() => {
    for (const { href } of NAV_LINKS) router.prefetch(href);
  }, [router]);
}

export function BottomNav() {
  const pathname = usePathname();
  useEagerPrefetch();
  return (
    <nav className="fixed bottom-0 inset-x-0 h-16 border-t bg-background flex md:hidden z-20">
      {NAV_LINKS.map(({ href, label, Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors",
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
