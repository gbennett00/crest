import { Suspense } from "react";
import { UserMenu } from "@/components/user-menu";
import { BottomNav, Sidebar } from "@/components/nav";
import { Logo } from "@/components/logo";
import { QueryProvider } from "@/lib/query-client";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <div className="h-dvh flex flex-col overflow-hidden">
        <header className="sticky top-0 z-20 min-h-12 border-b bg-background flex items-center px-4 justify-between shrink-0 pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-2">
            <Logo size={24} />
            <span className="font-semibold tracking-tight text-primary">Crest</span>
          </div>
          <UserMenu isProduction={process.env.VERCEL_ENV === "production"} />
        </header>

        <div className="flex flex-1 min-h-0">
          <Suspense fallback={<div className="hidden md:block w-48 border-r" />}>
            <Sidebar />
          </Suspense>
          <main className="flex-1 min-w-0 overflow-auto overscroll-none pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </main>
        </div>

        <Suspense
          fallback={
            <nav className="fixed bottom-0 inset-x-0 min-h-16 border-t bg-background md:hidden pb-[env(safe-area-inset-bottom)]" />
          }
        >
          <BottomNav />
        </Suspense>
      </div>
    </QueryProvider>
  );
}
