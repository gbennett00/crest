"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { AddTransactionForm } from "@/components/transactions/add-transaction-form";
import type { AccountOption, CategoryOption } from "@/components/transactions/add-transaction-form";

export function HomeAddTransaction({
  accounts,
  categories,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 md:bottom-6 z-30 flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-full shadow-lg font-semibold text-sm hover:opacity-90 transition-opacity"
      >
        <Plus size={16} />
        Add Transaction
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-end sm:items-center justify-center">
          <div className="bg-background w-full sm:max-w-md sm:rounded-2xl max-h-[90dvh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-background z-10">
              <h2 className="font-semibold text-base">Add Transaction</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-2 pb-4">
              <AddTransactionForm
                accounts={accounts}
                categories={categories}
                initialOpen={true}
                embedded={true}
                onSuccess={() => setOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
