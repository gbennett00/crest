"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  completeAccountLinking,
  createLinkToken,
  exchangePublicToken,
} from "@/app/(app)/accounts/actions";
import { Link2 } from "lucide-react";

type PlaidAccountOption = { id: string; name: string };
type UnlinkedAccountOption = { id: string; name: string; type: string };

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
        pendingLink.plaidAccounts.map((a) => ({
          plaidAccountId: a.id,
          existingAccountId: mapping[a.id] || null,
        })),
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setPendingLink(null);
    });
  }

  if (pendingLink) {
    return (
      <div className="border rounded-lg p-4 space-y-3 w-full max-w-md">
        <h3 className="font-semibold text-sm">Link detected accounts</h3>
        <p className="text-xs text-muted-foreground">
          If one of these was already imported from YNAB, attach it to that existing account so
          history isn&apos;t duplicated — overlapping transactions from the last ~90 days are
          matched to your imported ones automatically. Otherwise leave it as &quot;Create new&quot;.
          Suggested matches are pre-selected below.
        </p>
        {pendingLink.plaidAccounts.map((a) => (
          <div key={a.id} className="flex items-center gap-2">
            <span className="text-sm flex-1 min-w-0 truncate">{a.name}</span>
            <select
              className={selectClass()}
              value={mapping[a.id] ?? ""}
              onChange={(e) => setMapping((prev) => ({ ...prev, [a.id]: e.target.value }))}
            >
              <option value="">Create new</option>
              {pendingLink.unlinkedAccounts.map((existing) => (
                <option key={existing.id} value={existing.id}>
                  Attach to &quot;{existing.name}&quot;
                </option>
              ))}
            </select>
          </div>
        ))}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button onClick={handleFinishLinking} disabled={isPending} className="w-full h-9">
          {isPending ? "Linking…" : "Finish Linking"}
        </Button>
      </div>
    );
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
        {isPending ? "Linking…" : "Link Bank Account"}
      </Button>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
