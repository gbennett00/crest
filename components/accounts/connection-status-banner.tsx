"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import type { ItemConnection } from "@/lib/plaid/connection-health";
import { connectionCopy } from "@/lib/plaid/connection-copy";
import {
  completeRepair,
  createRepairLinkToken,
  unlinkItem,
} from "@/app/(app)/accounts/actions";

/**
 * Shown on a linked account's register when its bank connection isn't healthy.
 *
 * - Needs repair: Reconnect opens Plaid Link in update mode on the existing
 *   Item (same item_id, accounts and cursor, so nothing duplicates).
 * - Delayed: informational only; it resolves on its own.
 *
 * When Plaid can't repair the Item at all (access revoked at the bank), offers
 * Disconnect so the user can link the bank again and attach these accounts.
 */
export function ConnectionStatusBanner({ connection }: { connection: ItemConnection }) {
  const copy = connectionCopy(connection);
  const queryClient = useQueryClient();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsRelink, setNeedsRelink] = useState(connection.reason === "revoked");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onSuccess = useCallback(() => {
    setLinkToken(null);
    startTransition(async () => {
      const result = await completeRepair(connection.plaidItemId);
      if (result.error) {
        setError(result.error);
        return;
      }
      invalidateAllLedgerQueries(queryClient);
    });
  }, [connection.plaidItemId, queryClient]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: (err) => {
      setLinkToken(null);
      if (err) setError(err.display_message || err.error_message || "Reconnect didn't finish.");
    },
  });

  // Open Link as soon as the freshly fetched update-mode token is loaded.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  if (!copy) return null;

  const repair = connection.state === "needs_repair";

  function handleReconnect() {
    setError(null);
    startTransition(async () => {
      const result = await createRepairLinkToken(connection.plaidItemId);
      if ("linkToken" in result && result.linkToken) {
        setLinkToken(result.linkToken);
        return;
      }
      setError(result.error ?? "Couldn't start reconnect.");
      if ("relink" in result && result.relink) setNeedsRelink(true);
    });
  }

  function handleDisconnect() {
    setError(null);
    startTransition(async () => {
      const result = await unlinkItem(connection.plaidItemId);
      if (result.error) {
        setError(result.error);
        return;
      }
      invalidateAllLedgerQueries(queryClient);
    });
  }

  const Icon = repair ? AlertTriangle : Clock;

  return (
    <div
      role={repair ? "alert" : "status"}
      className={cn(
        "mx-4 mt-3 rounded-ds-md p-3 space-y-2",
        repair ? "bg-neg-bg text-neg-ink" : "bg-warn-bg text-warn-ink",
      )}
    >
      <div className="flex gap-2.5">
        <Icon size={18} className="shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 space-y-0.5">
          <p className="text-body-strong">{copy.title}</p>
          <p className="text-caption">{copy.body}</p>
        </div>
      </div>

      {error && <p className="text-caption pl-7">{error}</p>}

      {repair && (
        <div className="flex flex-wrap gap-2 pl-7">
          {confirmDisconnect ? (
            <>
              <p className="text-caption w-full">
                Your accounts and transactions stay in Crest; they just stop importing until you
                link the bank again and attach them.
              </p>
              <Button size="sm" variant="secondary" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="destructive" disabled={isPending} onClick={handleDisconnect}>
                {isPending ? "Disconnecting…" : "Disconnect"}
              </Button>
            </>
          ) : (
            <>
              {copy.canReconnect && (
                <Button size="sm" disabled={isPending || !!linkToken} onClick={handleReconnect}>
                  {isPending || linkToken ? "Reconnecting…" : "Reconnect"}
                </Button>
              )}
              {needsRelink && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => setConfirmDisconnect(true)}
                >
                  Disconnect
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
