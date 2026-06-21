"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { upsertTarget, deleteTarget } from "@/app/(app)/budget/actions";
import { Target, X } from "lucide-react";

type TargetType = "fill_up_to" | "set_aside" | "by_date";

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
  existingTarget?: { type: TargetType; amountCents: number; targetDate: string | null } | null;
  // Controlled mode: when `open`/`onOpenChange` are supplied (e.g. opened from a
  // row's three-dot menu), the internal trigger can be hidden with showTrigger=false.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const router = useRouter();
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [type, setType] = useState<TargetType>(existingTarget?.type ?? "fill_up_to");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasTarget = !!existingTarget;

  function handleSave() {
    setError(null);
    const rawAmount = amountRef.current?.value ?? "";
    const amountCents = Math.round(parseFloat(rawAmount) * 100);
    const targetDate = type === "by_date" ? (dateRef.current?.value ?? null) : null;

    if (!rawAmount || isNaN(amountCents) || amountCents <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (type === "by_date" && !targetDate) {
      setError("Target date is required");
      return;
    }

    startTransition(async () => {
      const result = await upsertTarget(entityId, entityType, type, amountCents, targetDate);
      if (result?.error) {
        setError(result.error);
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteTarget(entityId, entityType);
      setOpen(false);
      router.refresh();
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
              {(["fill_up_to", "set_aside", "by_date"] as TargetType[]).map((t) => (
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
                  {t === "fill_up_to" ? "Fill up to" : t === "set_aside" ? "Set aside" : "By date"}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Amount</Label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
              <Input
                ref={amountRef}
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={existingTarget ? (existingTarget.amountCents / 100).toFixed(2) : ""}
                placeholder="0.00"
                className="h-7 text-xs pl-5"
              />
            </div>
          </div>

          {/* Target date for by_date */}
          {type === "by_date" && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Target date</Label>
              <Input
                ref={dateRef}
                type="date"
                defaultValue={existingTarget?.targetDate ?? ""}
                className="h-7 text-xs"
              />
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
