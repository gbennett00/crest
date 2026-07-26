"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Button } from "@/components/ui/button";
import { createLinkToken, exchangePublicToken } from "@/app/(app)/accounts/actions";
import { Link2 } from "lucide-react";

export function LinkAccountButton() {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
    return () => { cancelled = true; };
  }, []);

  const onSuccess = useCallback(
    (publicToken: string) => {
      setError(null);
      startTransition(async () => {
        const result = await exchangePublicToken(publicToken);
        if (result.error) {
          setError(result.error);
        }
      });
    },
    [],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

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
      {error && (
        <p className="text-xs text-destructive mt-1">{error}</p>
      )}
    </div>
  );
}
