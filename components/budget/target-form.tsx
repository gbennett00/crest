"use client";

import { useRef, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { upsertTarget, deleteTarget } from "@/app/(app)/budget/actions";
import { TARGET_REPEAT_INTERVALS, repeatIntervalLabel } from "@/lib/budget/compute";
import type { TargetData, TargetType } from "@/lib/budget/types";
import { Target, X } from "lucide-react";

const TYPE_LABELS: Record<TargetType, string> = {
  fill_up_to: "Fill up to",
  set_aside: "Set aside",
  by_date: "By date",
  sinking: "Sinking fund",
};

export function TargetButton({
  entityId,
  entityType,
  existingTarget,
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: {
  entityId: string;
  entityType: "category" | "group";
  existingTarget?: TargetData | null;
  // Controlled mode: when `open`/`onOpenChange` are supplied (e.g. opened from a
  // row's three-dot menu), the internal trigger can be hidden with showTrigger=false.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const queryClient = useQueryClient();
  const dateRef = useRef<HTMLInputElement>(null);
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [type, setType] = useState<TargetType>(existingTarget?.type ?? "fill_up_to");
  const [amountCents, setAmountCents] = useState(existingTarget?.amountCents ?? 0);
  const [repeatIntervalMonths, setRepeatIntervalMonths] = useState<number | null>(
    existingTarget?.repeatIntervalMonths ?? null,
  );
  // A sinking target always has a cycle; by_date may also "not repeat".
  const intervalChoices: (number | null)[] = [
    ...(type === "by_date" ? [null] : []),
    ...TARGET_REPEAT_INTERVALS,
    // Keep an interval set elsewhere visible even if it isn't offered here.
    ...(repeatIntervalMonths !== null &&
    !(TARGET_REPEAT_INTERVALS as readonly number[]).includes(repeatIntervalMonths)
      ? [repeatIntervalMonths]
      : []),
  ];
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasTarget = !!existingTarget;

  function handleSave() {
    setError(null);
    const targetDate = type === "by_date" ? (dateRef.current?.value ?? null) : null;

    if (amountCents <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (type === "by_date" && !targetDate) {
      setError("Target date is required");
      return;
    }
    const interval =
      type === "sinking" ? (repeatIntervalMonths ?? 12) : type === "by_date" ? repeatIntervalMonths : null;

    startTransition(async () => {
      const result = await upsertTarget(
        entityId,
        entityType,
        type,
        amountCents,
        targetDate,
        interval,
      );
      if (result?.error) {
        setError(result.error);
      } else {
        setOpen(false);
        invalidateAllLedgerQueries(queryClient);
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteTarget(entityId, entityType);
      setOpen(false);
      invalidateAllLedgerQueries(queryClient);
    });
  }

  return (
    <span className="relative inline-block">
      {showTrigger && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={cn(
            "p-0.5 rounded transition-colors",
            hasTarget
              ? "text-primary hover:text-primary/80"
              : "text-muted-foreground/40 hover:text-muted-foreground",
          )}
          title={hasTarget ? "Edit target" : "Set target"}
        >
          <Target size={13} />
        </button>
      )}

      {open && (
        <div className="absolute left-0 bottom-7 z-50 w-64 bg-background border rounded-lg shadow-lg p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Target</span>
            <button
              type="button"
              onClick={() => { setOpen(false); setError(null); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={13} />
            </button>
          </div>

          {/* Type */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <div className="flex gap-1 flex-wrap">
              {(Object.keys(TYPE_LABELS) as TargetType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "px-2 py-1 rounded text-xs border transition-colors",
                    type === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-input bg-background hover:bg-muted",
                  )}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {type === "sinking" ? "Amount needed each cycle" : "Amount"}
            </Label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
              <CurrencyInput
                cents={amountCents}
                onCentsChange={setAmountCents}
                className="h-7 text-xs pl-5"
              />
            </div>
          </div>

          {/* Target date for by_date */}
          {type === "by_date" && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Target date</Label>
              {/* appearance-none strips iOS Safari's native chrome for this
                  compound control, which otherwise lays itself out at an
                  intrinsic width that ignores width/max-width and overflows
                  this narrow popup. */}
              <Input
                ref={dateRef}
                type="date"
                defaultValue={existingTarget?.targetDate ?? ""}
                className="h-7 text-xs block w-full appearance-none"
              />
            </div>
          )}

          {/* Repeat cadence, e.g. car insurance every 6 months, Christmas
              every 12 months. A by_date due date rolls forward to its next
              occurrence automatically once it's passed. */}
          {(type === "by_date" || type === "sinking") && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Repeats</Label>
              <div className="flex gap-1 flex-wrap">
                {intervalChoices.map((value) => {
                  const selected =
                    type === "sinking"
                      ? (repeatIntervalMonths ?? 12) === value
                      : repeatIntervalMonths === value;
                  return (
                    <button
                      key={value ?? "none"}
                      type="button"
                      onClick={() => setRepeatIntervalMonths(value)}
                      className={cn(
                        "px-2 py-1 rounded text-xs border transition-colors",
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-input bg-background hover:bg-muted",
                      )}
                    >
                      {value === null ? "Doesn't repeat" : repeatIntervalLabel(value)}
                    </button>
                  );
                })}
              </div>
              {type === "sinking" && (
                <p className="text-[11px] text-muted-foreground">
                  Adds this amount ÷ the cycle to the Sinking Fund&rsquo;s target every month.
                  Moving the money into this category is up to you.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-6 text-xs px-2 flex-1"
              disabled={isPending}
              onClick={handleSave}
            >
              {isPending ? "…" : "Save"}
            </Button>
            {hasTarget && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 text-xs px-2 text-destructive border-destructive/30 hover:bg-destructive/5"
                onClick={handleDelete}
                disabled={isPending}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
