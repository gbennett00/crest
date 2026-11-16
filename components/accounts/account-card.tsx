"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Money } from "@/components/money";
import { cn } from "@/lib/utils";
import { prefetchAccountRegister } from "@/lib/queries/accounts";
import { ChevronRight, Link2 } from "lucide-react";
import type { ItemConnection } from "@/lib/plaid/connection-health";
import { connectionCopy } from "@/lib/plaid/connection-copy";

export type AccountData = {
  id: string;
  name: string;
  type: "checking" | "savings" | "credit" | "asset" | "liability";
  workingBalanceCents: number;
  isLinked: boolean;
  isActive: boolean;
  connection?: ItemConnection | null;
};

const TYPE_LABELS: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit",
  asset: "Asset",
  liability: "Liability",
};

export function AccountCard({ account }: { account: AccountData }) {
  const queryClient = useQueryClient();
  const prefetch = () => prefetchAccountRegister(queryClient, account.id);
  return (
    <Link
      href={`/accounts/${account.id}`}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onPointerDown={prefetch}
      className={cn(
        "flex items-center justify-between px-4 py-3.5 hover:bg-muted/30 transition-colors",
        !account.isActive && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{account.name}</span>
          {account.isLinked && (
            <Link2 size={12} className="text-muted-foreground shrink-0" />
          )}
          {account.isActive && account.connection && (
            <ConnectionBadge connection={account.connection} />
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
          <Money cents={account.workingBalanceCents} />
        </span>
        <ChevronRight size={14} className="text-muted-foreground" />
      </div>
    </Link>
  );
}

function ConnectionBadge({ connection }: { connection: ItemConnection }) {
  const copy = connectionCopy(connection);
  if (!copy) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-pill px-2 py-0.5 text-[12px] leading-4 font-medium",
        connection.state === "needs_repair" ? "bg-neg-bg text-neg-ink" : "bg-warn-bg text-warn-ink",
      )}
    >
      {copy.label}
    </span>
  );
}
