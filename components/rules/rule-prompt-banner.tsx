"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createRuleAction } from "@/app/(app)/rules/actions";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import {
  clearRulePrompt,
  dismissRulePrompt,
  useRulePrompt,
} from "@/lib/category-rules/prompt-store";

// Long enough to read and decide; it isn't remembered, so it can come back
// the next time this payee is categorized.
const AUTO_HIDE_MS = 15_000;
const CONFIRMATION_MS = 4_000;

/**
 * "Always categorize <payee> as <category>?" — offered after the user picks a
 * category for an imported transaction (see buildRulePrompt for when). One at
 * a time, floating above the bottom nav. ✕ stops offering it for that payee
 * on this device.
 */
export function RulePromptBanner() {
  const prompt = useRulePrompt();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!prompt || isPending) return;
    const timer = setTimeout(clearRulePrompt, AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [prompt, isPending]);

  useEffect(() => {
    if (!confirmation) return;
    const timer = setTimeout(() => setConfirmation(null), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [confirmation]);

  // Never cover the edit form itself or the rules page.
  const hidden = pathname.startsWith("/transactions/") || pathname.startsWith("/rules");

  if (hidden || (!prompt && !confirmation)) return null;

  function createRule() {
    if (!prompt) return;
    setError(null);
    startTransition(async () => {
      const result = await createRuleAction({
        matchType: "exact",
        matchText: prompt.payeeKey,
        direction: prompt.direction,
        minCents: null,
        maxCents: null,
        accountId: null,
        categoryId: prompt.categoryId,
      });
      if (result.error !== undefined) {
        setError(result.error);
        return;
      }
      invalidateAllLedgerQueries(queryClient);
      clearRulePrompt();
      setConfirmation(
        result.updatedPending > 0
          ? `Rule created. Updated ${result.updatedPending} pending transaction${result.updatedPending === 1 ? "" : "s"}.`
          : "Rule created.",
      );
    });
  }

  function customize() {
    if (!prompt) return;
    const params = new URLSearchParams({
      new: "1",
      payee: prompt.payee,
      category: prompt.categoryId,
      direction: prompt.direction,
    });
    clearRulePrompt();
    router.push(`/rules?${params}`);
  }

  return (
    <div
      className="fixed inset-x-0 z-30 px-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-4 md:left-auto md:right-4 md:w-[26rem] md:px-0"
      role="status"
    >
      <div className="rounded-lg border bg-background shadow-lg p-3">
        {prompt ? (
          <div className="flex items-start gap-2.5">
            <Wand2 size={16} className="text-primary mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm">
                Always categorize <span className="font-medium">{prompt.payee}</span> as{" "}
                <span className="font-medium">{prompt.categoryName}</span>?
              </p>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={createRule} disabled={isPending}>
                  {isPending ? "Creating…" : "Create rule"}
                </Button>
                <Button size="sm" variant="ghost" onClick={customize} disabled={isPending}>
                  Customize…
                </Button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismissRulePrompt(prompt.payeeKey)}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label={`Don’t ask again for ${prompt.payee}`}
              title="Don’t ask again for this payee"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <p className="text-sm">{confirmation}</p>
        )}
      </div>
    </div>
  );
}
