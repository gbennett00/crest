"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, MoreHorizontal, Scale } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ReconcileDialog } from "./reconcile-dialog";

export function AccountDetailHeader({
  accountId,
  accountName,
  registerClearedBalanceCents,
  bankClearedBalanceCents,
  backHref,
}: {
  accountId: string;
  accountName: string;
  registerClearedBalanceCents: number;
  bankClearedBalanceCents: number;
  backHref: string;
}) {
  const [reconcileOpen, setReconcileOpen] = useState(false);

  return (
    <>
      <div className="sticky top-12 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Link href={backHref} className="text-muted-foreground hover:text-foreground shrink-0">
          <ChevronLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-sm truncate">{accountName}</h1>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted shrink-0">
              <MoreHorizontal size={18} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => setReconcileOpen(true)}>
              <Scale size={14} className="mr-2" />
              Reconcile
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {reconcileOpen && (
        <ReconcileDialog
          accountId={accountId}
          registerClearedBalanceCents={registerClearedBalanceCents}
          bankClearedBalanceCents={bankClearedBalanceCents}
          onClose={() => setReconcileOpen(false)}
        />
      )}
    </>
  );
}
