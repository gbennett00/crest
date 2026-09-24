"use client";

import { useMemo, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFormattedCents } from "@/components/money";
import { AssignmentAmountEditor } from "@/components/ui/assignment-amount-input";
import { bulkAssign } from "@/app/(app)/budget/actions";
import { buildBudgetEntries, type BudgetEntry, type EntryKey } from "@/lib/budget/entries";
import type { BudgetData } from "./budget-screen";

const RTA_KEY: EntryKey = "rta";

export type CoverTarget = {
  type: "category" | "group";
  id: string;
  name: string;
  // The target's own assigned_cents before this popup makes any changes.
  originalAssigned: number;
  // The target's current (negative) available balance — the overspend amount.
  overspentCents: number;
};

/**
 * YNAB-style "Cover overspending": pulls money into an overspent category (or
 * group-budgeted group) from one or more other funded categories/groups, or
 * from Ready to Assign. Each source's contribution is independently editable
 * so a partial amount can be pulled from a category even when it could cover
 * the whole shortfall.
 */
export function CoverOverspendingPopup({
  data,
  target,
  onClose,
}: {
  data: BudgetData;
  target: CoverTarget;
  onClose: () => void;
}) {
  const formatCents = useFormattedCents();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const amountNeeded = -target.overspentCents;
  const targetKey: EntryKey = target.type === "category" ? `c:${target.id}` : `g:${target.id}`;

  const sources = useMemo(
    () => buildBudgetEntries(data).filter((e) => e.key !== targetKey && e.currentAvailable > 0),
    [data, targetKey],
  );

  const [amounts, setAmounts] = useState<Record<EntryKey, number>>({});

  const totalCovered = Object.values(amounts).reduce((sum, v) => sum + v, 0);
  const remaining = amountNeeded - totalCovered;

  // Clamps a source's contribution to its own available balance and to the
  // overall amount still needed, so the total can never exceed the overspend.
  function setAmount(key: EntryKey, raw: number, maxAvailable: number) {
    const others = totalCovered - (amounts[key] ?? 0);
    const clamped = Math.max(0, Math.min(raw, maxAvailable, amountNeeded - others));
    setAmounts((prev) => ({ ...prev, [key]: clamped }));
  }

  function handleFill(key: EntryKey, maxAvailable: number) {
    setAmount(key, (amounts[key] ?? 0) + remaining, maxAvailable);
  }

  function handleSave() {
    if (totalCovered <= 0) return;
    setError(null);

    const assignments: { type: "category" | "group"; id: string; amountCents: number }[] = [
      { type: target.type, id: target.id, amountCents: target.originalAssigned + totalCovered },
    ];

    for (const source of sources) {
      const amount = amounts[source.key] ?? 0;
      if (amount <= 0) continue;
      assignments.push({
        type: source.type,
        id: source.id,
        amountCents: source.originalAssigned - amount,
      });
    }
    // Ready to Assign isn't a real row — pulling from it only requires the
    // target's own assignment above, same as the existing "assign to cover".

    startTransition(async () => {
      const result = await bulkAssign(assignments, data.month);
      if (result?.success) {
        invalidateAllLedgerQueries(queryClient);
        onClose();
      } else {
        setError("Failed to cover overspending.");
      }
    });
  }

  const grouped: { groupName: string; entries: BudgetEntry[] }[] = [];
  for (const entry of sources) {
    const last = grouped[grouped.length - 1];
    if (last && last.groupName === entry.groupName) last.entries.push(entry);
    else grouped.push({ groupName: entry.groupName, entries: [entry] });
  }

  const hasRta = data.rtaAvailableCents > 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-background w-full sm:max-w-lg sm:rounded-2xl flex flex-col max-h-[92dvh] sm:max-h-[85dvh] shadow-2xl text-left"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="min-w-0">
            <h2 className="font-semibold text-base">Cover overspending</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{target.name}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Sticky progress */}
        <div className="px-5 py-4 border-b bg-muted/20 shrink-0">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {remaining > 0 ? "Still needed" : "Fully covered"}
            </p>
            <p
              className={cn(
                "text-xl font-bold tabular-nums",
                remaining > 0 ? "text-destructive" : "text-primary",
              )}
            >
              {formatCents(Math.max(remaining, 0))}
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {formatCents(totalCovered)} of {formatCents(amountNeeded)} covered
          </p>
        </div>

        {/* Scrollable source list */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {hasRta && (
            <div>
              <div className="px-5 py-2 bg-muted/30 border-b">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Ready to Assign
                </p>
              </div>
              <SourceRow
                name="Ready to Assign"
                available={data.rtaAvailableCents}
                amount={amounts[RTA_KEY] ?? 0}
                canFill={remaining > 0 && (amounts[RTA_KEY] ?? 0) < data.rtaAvailableCents}
                onChange={(v) => setAmount(RTA_KEY, v, data.rtaAvailableCents)}
                onFill={() => handleFill(RTA_KEY, data.rtaAvailableCents)}
              />
            </div>
          )}
          {grouped.map(({ groupName, entries }) => (
            <div key={groupName}>
              <div className="px-5 py-2 bg-muted/30 border-b">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {groupName}
                </p>
              </div>
              {entries.map((entry) => (
                <SourceRow
                  key={entry.key}
                  name={entry.name}
                  available={entry.currentAvailable}
                  amount={amounts[entry.key] ?? 0}
                  canFill={remaining > 0 && (amounts[entry.key] ?? 0) < entry.currentAvailable}
                  onChange={(v) => setAmount(entry.key, v, entry.currentAvailable)}
                  onFill={() => handleFill(entry.key, entry.currentAvailable)}
                />
              ))}
            </div>
          ))}
          {sources.length === 0 && !hasRta && (
            <p className="text-center text-sm text-muted-foreground py-16">
              No funded categories available to cover from.
            </p>
          )}
        </div>

        {/* Sticky footer */}
        <div className="px-5 py-4 border-t bg-background shrink-0 space-y-2">
          {error && <p className="text-xs text-destructive text-center">{error}</p>}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={totalCovered <= 0 || isPending}>
              {isPending ? "…" : `Cover ${formatCents(totalCovered)}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceRow({
  name,
  available,
  amount,
  canFill,
  onChange,
  onFill,
}: {
  name: string;
  available: number;
  amount: number;
  canFill: boolean;
  onChange: (cents: number) => void;
  onFill: () => void;
}) {
  const formatCents = useFormattedCents();
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex items-center gap-3 px-5 py-3 border-b last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{name}</p>
        <p className="text-xs text-muted-foreground">{formatCents(available)} available</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {canFill && (
          <button
            type="button"
            onClick={onFill}
            className="text-xs font-medium text-primary hover:underline"
          >
            Max
          </button>
        )}
        <div className="w-24">
          {editing ? (
            <AssignmentAmountEditor
              original={amount}
              onCommit={(cents) => {
                onChange(cents);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
              formatCents={formatCents}
              showDollarSign
              className="w-full md:text-sm py-1.5"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={cn(
                "w-full rounded-md border border-input bg-background px-2 py-1.5 text-base md:text-sm text-right tabular-nums",
                "hover:bg-accent transition-colors",
              )}
            >
              {formatCents(amount)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
