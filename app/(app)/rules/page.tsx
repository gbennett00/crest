"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { StickyHeader } from "@/components/ui/sticky-header";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { InfoTip } from "@/components/ui/info-tip";
import { RuleEditor } from "@/components/rules/rule-editor";
import { useRules } from "@/lib/queries/rules";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import { describeRuleConditions } from "@/lib/category-rules/logic";
import type { CategoryRuleInput } from "@/lib/category-rules/types";
import type { RuleListRow } from "@/app/api/rules/route";
import { useHasMounted } from "@/lib/use-has-mounted";

const EMPTY_RULE: CategoryRuleInput = {
  matchType: "exact",
  matchText: "",
  direction: "outflow",
  minCents: null,
  maxCents: null,
  accountId: null,
  categoryId: "",
};

/**
 * Prefill from the URL — the "Customize…" link on the make-this-a-rule
 * banner opens `/rules?new=1&payee=…&category=…&direction=…`.
 */
function ruleFromParams(params: URLSearchParams): CategoryRuleInput | null {
  if (params.get("new") !== "1") return null;
  return {
    ...EMPTY_RULE,
    matchText: params.get("payee") ?? "",
    categoryId: params.get("category") ?? "",
    direction: params.get("direction") === "inflow" ? "inflow" : "outflow",
  };
}

type Editing = { ruleId?: string; initial: CategoryRuleInput };

export default function RulesPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <RulesContent />
    </Suspense>
  );
}

function RulesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const hasMounted = useHasMounted();
  const { data, isPending, isError } = useRules();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Open the editor prefilled when arriving from the banner's "Customize…".
  useEffect(() => {
    const initial = ruleFromParams(new URLSearchParams(searchParams.toString()));
    if (initial) {
      setEditing({ initial });
      router.replace("/rules");
    }
  }, [searchParams, router]);

  function closeEditor(result?: { deleted?: boolean; updatedPending?: number }) {
    setEditing(null);
    if (!result) return;
    invalidateAllLedgerQueries(queryClient);
    if (result.deleted) setNotice("Rule deleted.");
    else if (result.updatedPending)
      setNotice(
        `Rule saved. Updated ${result.updatedPending} pending transaction${result.updatedPending === 1 ? "" : "s"}.`,
      );
    else setNotice("Rule saved.");
  }

  function editRule(rule: RuleListRow) {
    setNotice(null);
    setEditing({
      ruleId: rule.id,
      initial: {
        matchType: rule.matchType,
        matchText: rule.matchText,
        direction: rule.direction,
        minCents: rule.minCents,
        maxCents: rule.maxCents,
        accountId: rule.accountId,
        categoryId: rule.categoryId,
      },
    });
  }

  return (
    <div className="max-w-2xl">
      <StickyHeader className="px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Back"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-0.5 flex-1 min-w-0">
          <h1 className="font-semibold text-sm truncate">Categorization rules</h1>
          <InfoTip label="About categorization rules">
            Rules suggest a category for incoming transactions. You still approve every one. When
            no rule matches, Crest suggests the category you’ve used for that payee at least 70% of
            the time recently.
          </InfoTip>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setNotice(null);
            setEditing({ initial: EMPTY_RULE });
          }}
        >
          <Plus /> New rule
        </Button>
      </StickyHeader>

      <div className="p-4 space-y-4">
        {notice && (
          <p className="text-sm rounded-md border bg-muted/30 px-3 py-2" role="status">
            {notice}
          </p>
        )}

        {!hasMounted || (isPending && !data) ? (
          <Skeleton />
        ) : isError || !data ? (
          <p className="text-sm text-destructive">Couldn’t load rules.</p>
        ) : data.rules.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center space-y-1">
            <p className="text-sm font-medium">No rules yet</p>
            <p className="text-xs text-muted-foreground">
              Create one here, or pick a category on an imported transaction and Crest will offer
              to make it a rule.
            </p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.rules.map((rule) => (
              <li key={rule.id}>
                <button
                  type="button"
                  onClick={() => editRule(rule)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      Payee {rule.matchType === "exact" ? "is" : "contains"} “{rule.matchText}”
                      <span className="text-muted-foreground font-normal"> → </span>
                      {rule.categoryName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {describeRuleConditions(rule, rule.accountName)}
                    </p>
                    {rule.categoryHidden && (
                      <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                        <AlertTriangle size={12} aria-hidden />
                        Category is hidden — this rule is paused until you pick another or unhide it.
                      </p>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={editing !== null && !!data}
        onClose={() => closeEditor()}
        title={editing?.ruleId ? "Edit rule" : "New rule"}
      >
        {editing && data && (
          <RuleEditor
            // Remount per rule so the form re-seeds from `initial`.
            key={editing.ruleId ?? "new"}
            ruleId={editing.ruleId}
            initial={editing.initial}
            categories={data.categories}
            accounts={data.accounts}
            onDone={closeEditor}
          />
        )}
      </Modal>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-14 bg-muted rounded" />
      ))}
    </div>
  );
}
