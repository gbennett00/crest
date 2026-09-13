"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AccountCard, type AccountData } from "./account-card";

/**
 * Collapsible list of closed accounts, rendered at the very bottom of the
 * accounts page. Collapsed by default so closed accounts stay out of the way
 * while remaining accessible (each card still links to its register).
 */
export function ClosedAccountsSection({ accounts }: { accounts: AccountData[] }) {
  const [open, setOpen] = useState(false);

  if (accounts.length === 0) return null;

  return (
    <div className="border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Closed accounts
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {accounts.length}
        </span>
      </button>
      {open && (
        <div className="divide-y border-t">
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </div>
      )}
    </div>
  );
}
