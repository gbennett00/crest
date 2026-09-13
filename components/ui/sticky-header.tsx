import { cn } from "@/lib/utils";

// Sub-page header bars live inside `main` (see app/(app)/layout.tsx), which is
// already the scrollable region right below the global app header — so this
// only ever needs `top-0`. Anchoring to any other offset (e.g. `top-12` to
// "clear" the global header) leaves a gap the header never covers, and
// scrolled content shows through above it. Pair with plain padding (not
// padding-top) on the page's container — no extra top offset is needed.
export function StickyHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("sticky top-0 z-10 bg-background border-b", className)}>
      {children}
    </div>
  );
}
