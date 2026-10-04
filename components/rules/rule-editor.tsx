"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/ui/info-tip";
import { CategoryPicker } from "@/components/transactions/category-picker";
import type {
  AccountOption,
  CategoryOption,
} from "@/components/transactions/transaction-form";
import {
  createRuleAction,
  deleteRuleAction,
  previewRuleAction,
  updateRuleAction,
} from "@/app/(app)/rules/actions";
import { validateRuleInput } from "@/lib/category-rules/logic";
import type {
  CategoryRuleInput,
  RuleDirection,
  RuleMatchType,
  RulePreview,
} from "@/lib/category-rules/types";
import { cn } from "@/lib/utils";

const selectClass = cn(
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
  "focus:outline-none focus:ring-1 focus:ring-ring h-9",
);

const PREVIEW_DEBOUNCE_MS = 300;

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md border p-0.5 gap-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Create / edit form for one categorization rule, with a live preview of how
 * many past transactions it would match. `ruleId` switches it to edit mode.
 * Amount bounds are inclusive and use 0 for "no bound": a minimum of $0
 * matches everything and a maximum must be above $0, so neither loses a
 * meaningful value.
 */
export function RuleEditor({
  ruleId,
  initial,
  categories,
  accounts,
  onDone,
}: {
  ruleId?: string;
  initial: CategoryRuleInput;
  categories: CategoryOption[];
  accounts: AccountOption[];
  /** Called after a save or delete; `updatedPending` is how many pending rows changed. */
  onDone: (result: { deleted?: boolean; updatedPending?: number }) => void;
}) {
  const [matchType, setMatchType] = useState<RuleMatchType>(initial.matchType);
  const [matchText, setMatchText] = useState(initial.matchText);
  const [direction, setDirection] = useState<RuleDirection>(initial.direction);
  const [minCents, setMinCents] = useState(initial.minCents ?? 0);
  const [maxCents, setMaxCents] = useState(initial.maxCents ?? 0);
  const [accountId, setAccountId] = useState(initial.accountId ?? "");
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [isPending, startTransition] = useTransition();

  const input: CategoryRuleInput = {
    matchType,
    matchText,
    direction,
    minCents: minCents > 0 ? minCents : null,
    maxCents: maxCents > 0 ? maxCents : null,
    accountId: accountId || null,
    categoryId,
  };

  // Debounced live preview. Keyed on the primitive fields so typing in the
  // match text doesn't fire a request per keystroke.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await previewRuleAction({
        matchType,
        matchText,
        direction,
        minCents: minCents > 0 ? minCents : null,
        maxCents: maxCents > 0 ? maxCents : null,
        accountId: accountId || null,
      });
      if (!cancelled) setPreview(result);
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [matchType, matchText, direction, minCents, maxCents, accountId]);

  function save() {
    const invalid = validateRuleInput(input);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = ruleId
        ? await updateRuleAction(ruleId, input)
        : await createRuleAction(input);
      if (result.error !== undefined) setError(result.error);
      else onDone({ updatedPending: result.updatedPending });
    });
  }

  function remove() {
    if (!ruleId) return;
    startTransition(async () => {
      const result = await deleteRuleAction(ruleId);
      if (result.error) setError(result.error);
      else onDone({ deleted: true });
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-0.5">
          <Label htmlFor="rule-match-text" className="text-xs">
            When the payee
          </Label>
          <InfoTip label="How payees are matched">
            Case, punctuation and store numbers (like “#117”) are ignored, so “MAVERIK #117” and
            “Maverik” match the same rule.
          </InfoTip>
        </div>
        <Segmented
          label="Match type"
          value={matchType}
          onChange={setMatchType}
          options={[
            { value: "exact", label: "Is" },
            { value: "contains", label: "Contains" },
          ]}
        />
        <Input
          id="rule-match-text"
          value={matchText}
          onChange={(e) => setMatchText(e.target.value)}
          placeholder={matchType === "exact" ? "e.g. Maverik" : "e.g. amazon"}
          autoComplete="off"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Money</Label>
        <Segmented
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "outflow", label: "Outflow" },
            { value: "inflow", label: "Inflow" },
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rule-min" className="text-xs">
            At least <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              $
            </span>
            <CurrencyInput
              id="rule-min"
              cents={minCents}
              onCentsChange={setMinCents}
              className="h-9 pl-6 text-sm tabular-nums"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rule-max" className="text-xs">
            At most <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              $
            </span>
            <CurrencyInput
              id="rule-max"
              cents={maxCents}
              onCentsChange={setMaxCents}
              className="h-9 pl-6 text-sm tabular-nums"
            />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rule-account" className="text-xs">
          Account
        </Label>
        <select
          id="rule-account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className={selectClass}
        >
          <option value="">Any account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rule-category" className="text-xs">
          Categorize as
        </Label>
        <CategoryPicker
          id="rule-category"
          categories={categories}
          value={categoryId}
          onChange={setCategoryId}
        />
      </div>

      <p className="text-xs text-muted-foreground min-h-4" aria-live="polite">
        {preview === null
          ? null
          : preview.matchCount === 0
            ? "Matches no past transactions."
            : `Matches ${preview.matchCount} past transaction${preview.matchCount === 1 ? "" : "s"}` +
              (preview.samplePayees.length > 0 ? `: ${preview.samplePayees.join(", ")}` : "") +
              "."}
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        {ruleId && (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={remove}
            disabled={isPending}
          >
            Delete
          </Button>
        )}
        <Button type="submit" className="ml-auto" disabled={isPending}>
          {isPending ? "Saving…" : ruleId ? "Save rule" : "Create rule"}
        </Button>
      </div>
    </form>
  );
}
