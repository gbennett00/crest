"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import {
  completeAccountLinking,
  createLinkToken,
  exchangePublicToken,
} from "@/app/(app)/accounts/actions";
import { Link2 } from "lucide-react";

type PlaidAccountOption = {
  id: string;
  name: string;
  mask: string | null;
  subtype: string | null;
};
type UnlinkedAccountOption = { id: string; name: string; type: string };

// Sentinel mapping value for "don't track this Plaid account at all". Can't
// collide with an existing-account id (those are UUIDs) or "" (create new).
const SKIP_VALUE = "__skip__";

type PendingLink = {
  itemId: string;
  plaidAccounts: PlaidAccountOption[];
  unlinkedAccounts: UnlinkedAccountOption[];
};

function selectClass() {
  return cn(
    "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm",
    "focus:outline-none focus:ring-1 focus:ring-ring",
  );
}

/**
 * Pre-select an "attach to existing" mapping by matching each Plaid account name
 * to an unlinked Crest account name (e.g. a YNAB-imported one). This surfaces the
 * attach option instead of silently defaulting every row to "Create new". Each
 * existing account is suggested at most once. The user can always override.
 */
function suggestMapping(
  plaidAccounts: PlaidAccountOption[],
  unlinked: UnlinkedAccountOption[],
): Record<string, string> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const mapping: Record<string, string> = {};
  const used = new Set<string>();

  for (const p of plaidAccounts) {
    const pn = norm(p.name);
    let pick = "";
    if (pn) {
      for (const u of unlinked) {
        if (used.has(u.id)) continue;
        const un = norm(u.name);
        if (un && (un === pn || un.includes(pn) || pn.includes(un))) {
          pick = u.id;
          break;
        }
      }
    }
    if (pick) used.add(pick);
    mapping[p.id] = pick;
  }

  return mapping;
}

export function LinkAccountButton() {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  // Per plaidAccount.id, either "" (create new) or an existing account id to attach to.
  const [mapping, setMapping] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    createLinkToken().then((result) => {
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
      } else if (result.linkToken) {
        setLinkToken(result.linkToken);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSuccess = useCallback((publicToken: string) => {
    setError(null);
    startTransition(async () => {
      const result = await exchangePublicToken(publicToken);
      if ("error" in result && result.error) {
        setError(result.error);
        return;
      }
      if ("itemId" in result && result.plaidAccounts && result.unlinkedAccounts) {
        setPendingLink({
          itemId: result.itemId,
          plaidAccounts: result.plaidAccounts,
          unlinkedAccounts: result.unlinkedAccounts,
        });
        setMapping(suggestMapping(result.plaidAccounts, result.unlinkedAccounts));
      }
    });
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  function handleFinishLinking() {
    if (!pendingLink) return;
    setError(null);
    startTransition(async () => {
      const result = await completeAccountLinking(
        pendingLink.itemId,
        pendingLink.plaidAccounts.map((a) => {
          const choice = mapping[a.id] ?? "";
          return {
            plaidAccountId: a.id,
            existingAccountId:
              choice && choice !== SKIP_VALUE ? choice : null,
            skip: choice === SKIP_VALUE,
          };
        }),
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setPendingLink(null);
    });
  }

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => open()}
        disabled={!ready || isPending}
      >
        <Link2 size={14} />
        {isPending && !pendingLink ? "Linking…" : "Link Bank Account"}
      </Button>
      {error && !pendingLink && (
        <p className="text-xs text-destructive mt-1">{error}</p>
      )}

      <Modal
        open={!!pendingLink}
        onClose={() => {
          if (isPending) return;
          setPendingLink(null);
          setError(null);
        }}
        title="Link detected accounts"
      >
        {pendingLink && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Choose what to do with each account your bank reported. If one was already
              imported from YNAB, attach it to that existing account so history isn&apos;t
              duplicated — overlapping transactions from the last ~90 days are matched to your
              existing ones automatically. Suggested matches are pre-selected. Pick
              &ldquo;Don&apos;t link this account&rdquo; for any you don&apos;t want in Crest.
            </p>

            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {pendingLink.plaidAccounts.map((a) => (
                <div key={a.id} className="space-y-1.5">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{a.name}</span>
                    {a.mask && (
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        ••{a.mask}
                      </span>
                    )}
                    {a.subtype && (
                      <span className="text-xs text-muted-foreground capitalize shrink-0">
                        {a.subtype}
                      </span>
                    )}
                  </div>
                  <select
                    className={cn(
                      selectClass(),
                      mapping[a.id] === SKIP_VALUE &&
                        "text-muted-foreground italic",
                    )}
                    value={mapping[a.id] ?? ""}
                    onChange={(e) =>
                      setMapping((prev) => ({ ...prev, [a.id]: e.target.value }))
                    }
                  >
                    <option value="">Create new account</option>
                    {pendingLink.unlinkedAccounts.map((existing) => (
                      <option key={existing.id} value={existing.id}>
                        Attach to “{existing.name}”
                      </option>
                    ))}
                    <option value={SKIP_VALUE}>Don’t link this account</option>
                  </select>
                </div>
              ))}
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button
              onClick={handleFinishLinking}
              disabled={isPending}
              className="w-full h-9"
            >
              {isPending ? "Linking…" : "Finish Linking"}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
