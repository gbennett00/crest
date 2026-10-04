"use client";

import { useMemo, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { useFormattedCents } from "@/components/money";
import { CategoryPicker } from "@/components/transactions/category-picker";
import { moveBudgetMoney } from "@/app/(app)/budget/actions";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import { buildMoveOptions, resolveMoveMoney, unitKey } from "@/lib/budget/move-money";
import type { BudgetUnit } from "@/lib/ledger";
import { cn } from "@/lib/utils";
import type { BudgetData } from "./budget-screen";

/**
 * "Move money" from a category/group row menu: moves assigned money out of
 * that funding unit into any other funding unit or Ready to Assign (or, after
 * swapping, into it from one), for the month in view. Recorded as a single
 * budget move.
 */
export function MoveMoneyPopup({
  data,
  unit,
  onClose,
}: {
  data: BudgetData;
  unit: BudgetUnit;
  onClose: () => void;
}) {
  const formatCents = useFormattedCents();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const options = useMemo(() => buildMoveOptions(data), [data]);

  const [fromKey, setFromKey] = useState<string | null>(unitKey(unit));
  const [toKey, setToKey] = useState<string | null>(null);
  const [amountCents, setAmountCents] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const from = options.find((o) => o.id === fromKey) ?? null;
  const to = options.find((o) => o.id === toKey) ?? null;
  const resolved = resolveMoveMoney({ month: data.month, fromKey, toKey, amountCents });
  const leavesNegative = from !== null && amountCents > 0 && amountCents > from.availableCents;

  function swap() {
    setFromKey(toKey);
    setToKey(fromKey);
    setError(null);
  }

  function handleSave() {
    if ("error" in resolved) {
      setError(resolved.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await moveBudgetMoney(resolved.move);
      if (result?.success) {
        invalidateAllLedgerQueries(queryClient);
        onClose();
      } else {
        setError(result?.error ?? "Failed to move money.");
      }
    });
  }

  return (
    <Modal open onClose={onClose} title="Move money">
      <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
        <Side
          label="From"
          options={options}
          value={fromKey}
          onChange={setFromKey}
          availableCents={from?.availableCents ?? null}
          formatCents={formatCents}
        />

        <div className="flex justify-center">
          <button
            type="button"
            onClick={swap}
            className="rounded-full border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Swap from and to"
          >
            <ArrowUpDown size={14} />
          </button>
        </div>

        <Side
          label="To"
          options={options}
          value={toKey}
          onChange={setToKey}
          availableCents={to?.availableCents ?? null}
          formatCents={formatCents}
        />

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="move-amount" className="text-xs text-muted-foreground">
              Amount
            </Label>
            {from && from.availableCents > 0 && (
              <button
                type="button"
                onClick={() => setAmountCents(from.availableCents)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Max
              </button>
            )}
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              $
            </span>
            <CurrencyInput
              id="move-amount"
              cents={amountCents}
              onCentsChange={(c) => {
                setAmountCents(c);
                setError(null);
              }}
              className="pl-6 text-right tabular-nums"
            />
          </div>
          {leavesNegative && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              This leaves {from.name} at {formatCents(from.availableCents - amountCents)}.
            </p>
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={isPending || "error" in resolved}
          >
            {isPending ? "Moving…" : `Move ${formatCents(amountCents)}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Side({
  label,
  options,
  value,
  onChange,
  availableCents,
  formatCents,
}: {
  label: string;
  options: ReturnType<typeof buildMoveOptions>;
  value: string | null;
  onChange: (key: string) => void;
  availableCents: number | null;
  formatCents: (cents: number) => string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <CategoryPicker
        categories={options}
        value={value ?? ""}
        onChange={onChange}
        placeholder="Choose category…"
      />
      {availableCents !== null && (
        <p
          className={cn(
            "text-xs",
            availableCents < 0 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {formatCents(availableCents)} available
        </p>
      )}
    </div>
  );
}
