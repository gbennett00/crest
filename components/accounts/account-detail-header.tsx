"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, MoreHorizontal, Scale, Archive, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReconcileDialog } from "./reconcile-dialog";
import { CloseAccountDialog } from "./close-account-dialog";
import { reopenAccountAction } from "@/app/(app)/accounts/actions";

export function AccountDetailHeader({
  accountId,
  accountName,
  registerClearedBalanceCents,
  isLinked = false,
  bankBalanceCents = null,
  backHref,
  isActive,
  canClose,
  closeBlockReason,
}: {
  accountId: string;
  accountName: string;
  registerClearedBalanceCents: number;
  isLinked?: boolean;
  bankBalanceCents?: number | null;
  backHref: string;
  isActive: boolean;
  canClose: boolean;
  closeBlockReason?: string;
}) {
  const router = useRouter();
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [isReopening, startReopen] = useTransition();

  function handleReopen() {
    startReopen(async () => {
      await reopenAccountAction(accountId);
      router.refresh();
    });
  }

  return (
    <>
      <div className="sticky top-12 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Link href={backHref} className="text-muted-foreground hover:text-foreground shrink-0">
          <ChevronLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-sm truncate">{accountName}</h1>
          {!isActive && (
            <p className="text-xs text-muted-foreground">Closed</p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted shrink-0">
              <MoreHorizontal size={18} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {isActive ? (
              <>
                <DropdownMenuItem onClick={() => setReconcileOpen(true)}>
                  <Scale size={14} className="mr-2" />
                  Reconcile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!canClose}
                  onClick={() => {
                    if (canClose) setCloseOpen(true);
                  }}
                >
                  <Archive size={14} className="mr-2" />
                  <div className="flex flex-col">
                    <span>Close account</span>
                    {!canClose && closeBlockReason && (
                      <span className="text-xs text-muted-foreground">
                        {closeBlockReason}
                      </span>
                    )}
                  </div>
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={handleReopen} disabled={isReopening}>
                <RotateCcw size={14} className="mr-2" />
                {isReopening ? "Reopening…" : "Reopen account"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {reconcileOpen && (
        <ReconcileDialog
          accountId={accountId}
          registerClearedBalanceCents={registerClearedBalanceCents}
          isLinked={isLinked}
          bankBalanceCents={bankBalanceCents}
          onClose={() => setReconcileOpen(false)}
        />
      )}

      {closeOpen && (
        <CloseAccountDialog
          accountId={accountId}
          accountName={accountName}
          onClose={() => setCloseOpen(false)}
        />
      )}
    </>
  );
}
