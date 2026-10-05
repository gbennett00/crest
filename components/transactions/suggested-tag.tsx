import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Marks a pending transaction whose category was filled in automatically (by
 * a categorization rule or the payee's history) and hasn't been approved yet.
 * See docs/budgeting-app-architecture.md § AUTO-CATEGORIZATION.
 */
export function SuggestedTag({ className }: { className?: string }) {
  return (
    <span
      title="Suggested automatically — approve to keep it"
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-medium text-primary shrink-0",
        className,
      )}
    >
      <Sparkles size={11} aria-hidden />
      Suggested
    </span>
  );
}
