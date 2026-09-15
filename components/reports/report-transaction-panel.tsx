"use client";

import { X } from "lucide-react";
import { ReportTransactionList, type ReportTxn } from "./report-transaction-list";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-form";

export function ReportTransactionPanel({
  categoryName,
  periodLabel,
  transactions,
  categories,
  accounts,
  backHref,
  onClose,
}: {
  categoryName: string;
  periodLabel: string;
  transactions: ReportTxn[];
  categories: CategoryOption[];
  accounts: AccountOption[];
  backHref: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex justify-end" onClick={onClose}>
      <div
        className="bg-background w-full sm:w-[440px] h-full flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="min-w-0">
            <h2 className="font-semibold text-[15px] truncate">{categoryName}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {periodLabel} · {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <ReportTransactionList
            transactions={transactions}
            categories={categories}
            accounts={accounts}
            backHref={backHref}
          />
        </div>
      </div>
    </div>
  );
}
