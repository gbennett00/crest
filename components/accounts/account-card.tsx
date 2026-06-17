import Link from "next/link";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChevronRight, Link2 } from "lucide-react";

export type AccountData = {
  id: string;
  name: string;
  type: "checking" | "savings" | "credit";
  workingBalanceCents: number;
  isLinked: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit",
};

export function AccountCard({ account }: { account: AccountData }) {
  return (
    <Link
      href={`/accounts/${account.id}`}
      className="flex items-center justify-between px-4 py-3.5 hover:bg-muted/30 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{account.name}</span>
          {account.isLinked && (
            <Link2 size={12} className="text-muted-foreground shrink-0" />
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {TYPE_LABELS[account.type]}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            account.workingBalanceCents < 0 ? "text-destructive" : "",
          )}
        >
          {formatCents(account.workingBalanceCents)}
        </span>
        <ChevronRight size={14} className="text-muted-foreground" />
      </div>
    </Link>
  );
}
