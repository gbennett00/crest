import { Suspense } from "react";
import { UserMenu } from "@/components/user-menu";
import { BottomNav, Sidebar } from "@/components/nav";
import { Logo } from "@/components/logo";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      <header className="sticky top-0 z-20 h-12 border-b bg-background flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Logo size={24} />
          <span className="font-semibold tracking-tight text-primary">Crest</span>
        </div>
        <UserMenu />
      </header>

      <div className="flex flex-1 min-h-0">
        <Suspense fallback={<div className="hidden md:block w-48 border-r" />}>
          <Sidebar />
        </Suspense>
        <main className="flex-1 min-w-0 overflow-auto pb-20 md:pb-0">
          {children}
        </main>
      </div>

      <Suspense fallback={<nav className="fixed bottom-0 inset-x-0 h-16 border-t bg-background md:hidden" />}>
        <BottomNav />
      </Suspense>
    </div>
  );
}
