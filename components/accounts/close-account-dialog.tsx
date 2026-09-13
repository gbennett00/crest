"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { closeAccountAction } from "@/app/(app)/accounts/actions";
import { X, Archive } from "lucide-react";

/**
 * Confirmation shown when closing an account that already qualifies (all
 * transactions cleared, zero working balance). On success we route back to the
 * accounts list, where the account now lives under the closed-accounts toggle.
 */
export function CloseAccountDialog({
  accountId,
  accountName,
  onClose,
}: {
  accountId: string;
  accountName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await closeAccountAction(accountId);
      if (result.error) {
        setError(result.error);
      } else {
        router.push("/accounts");
        router.refresh();
      }
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-background rounded-2xl w-full max-w-sm shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-semibold text-base">Close account</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          <div className="flex justify-center">
            <div className="rounded-full bg-muted p-3">
              <Archive size={28} className="text-muted-foreground" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-snug text-center">
            Close <span className="font-medium text-foreground">{accountName}</span>?
            It will be hidden from your active accounts, but you can still view its
            history and reopen it anytime.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="space-y-2">
            <Button className="w-full" onClick={handleConfirm} disabled={isPending}>
              {isPending ? "Closing…" : "Yes, close account"}
            </Button>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
