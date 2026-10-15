"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { TransactionForm } from "@/components/transactions/transaction-form";
import { useHomeView } from "@/lib/queries/home";

const ACCOUNT_PATH = /^\/accounts\/([^/]+)\/?$/;

/**
 * The round Add button in the shell, and the sheet it opens. Account and
 * category options come from the home view cache, which the nav already warms
 * on mount, so there is no extra fetch. On an account's page the sheet
 * pre-selects that account.
 */
export function AddTransaction() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { data } = useHomeView();
  const defaultAccountId = ACCOUNT_PATH.exec(pathname)?.[1];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!data}
        aria-label="Add transaction"
        className={cn(
          "fixed right-dock-inset bottom-[calc(var(--dock-bottom)+0.5rem)] z-30 md:right-6 md:bottom-6",
          "flex size-14 items-center justify-center rounded-pill bg-brand text-brand-ink shadow-float transition-[filter] hover:brightness-95 disabled:opacity-40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <Plus size={28} strokeWidth={2} />
      </button>

      {data && (
        <Sheet open={open} onOpenChange={setOpen} title="Add transaction" className="px-2 pt-0">
          <TransactionForm
            accounts={data.accounts}
            categories={data.categories}
            defaultAccountId={defaultAccountId}
            initialOpen={true}
            embedded={true}
            onSuccess={() => setOpen(false)}
          />
        </Sheet>
      )}
    </>
  );
}
