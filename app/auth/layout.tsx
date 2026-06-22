import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="h-12 flex items-center px-6 border-b shrink-0 gap-2">
        <Logo size={24} />
        <span className="font-semibold tracking-tight">Crest</span>
      </header>
      <main className="flex-1 flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
