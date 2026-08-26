"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, FolderInput, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  bulkApproveTransactions,
  bulkCategorizeTransactions,
  bulkMoveTransactions,
  type BulkResult,
} from "@/app/(app)/transactions/actions";
import type {
  AccountOption,
  CategoryOption,
} from "@/components/transactions/transaction-form";

type Mode = "approve" | "categorize" | "move";

interface BulkActionsBarProps {
  selectedIds: string[];
  categories: CategoryOption[];
  accounts: AccountOption[];
  /** Which actions to offer. Defaults to all three. */
  actions?: { approve?: boolean; categorize?: boolean; move?: boolean };
  /** Account to exclude from the "move" targets (the register you're viewing). */
  currentAccountId?: string;
  /** Clear the selection (called after a successful action or Cancel-all). */
  onClearSelection: () => void;
}

function GroupedCategorySelect({
  value,
  onChange,
  categories,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  categories: CategoryOption[];
  disabled?: boolean;
}) {
  const grouped = useMemo(() => {
    const g: Record<string, CategoryOption[]> = {};
    for (const c of categories) (g[c.groupName] ??= []).push(c);
    return g;
  }, [categories]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-1.5 text-sm",
        "focus:outline-none focus:ring-1 focus:ring-ring",
      )}
    >
      {Object.entries(grouped).map(([group, cats]) => (
        <optgroup key={group} label={group}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function BulkActionsBar({
  selectedIds,
  categories,
  accounts,
  actions,
  currentAccountId,
  onClearSelection,
}: BulkActionsBarProps) {
  const show = {
    approve: actions?.approve ?? true,
    categorize: actions?.categorize ?? true,
    move: actions?.move ?? true,
  };

  const [mode, setMode] = useState<Mode | null>(null);
  const [category, setCategory] = useState(categories[0]?.id ?? "");
  const moveTargets = useMemo(
    () => accounts.filter((a) => a.id !== currentAccountId),
    [accounts, currentAccountId],
  );
  const [account, setAccount] = useState(moveTargets[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (selectedIds.length === 0) return null;

  function reset() {
    setMode(null);
    setError(null);
  }

  function handleResult(result: BulkResult) {
    if (result.error) {
      setError(result.error);
      return;
    }
    reset();
    onClearSelection();
  }

  function run(action: () => Promise<BulkResult>) {
    setError(null);
    startTransition(async () => {
      handleResult(await action());
    });
  }

  const count = selectedIds.length;

  return (
    <div className="fixed inset-x-0 bottom-16 md:bottom-4 z-40 flex justify-center px-3 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md rounded-xl border bg-background shadow-2xl overflow-hidden">
        {/* Picker row (shown when an action needs a choice) */}
        {mode && (
          <div className="flex flex-col gap-2 px-3 pt-3">
            {mode === "approve" && (
              <>
                <p className="text-xs text-muted-foreground">
                  Approve {count}. Uncategorized transactions get this category;
                  ones already categorized keep their splits.
                </p>
                <div className="flex items-center gap-2">
                  <GroupedCategorySelect
                    value={category}
                    onChange={setCategory}
                    categories={categories}
                    disabled={isPending}
                  />
                  <Button
                    size="sm"
                    className="h-8 text-xs shrink-0"
                    disabled={isPending || !category}
                    onClick={() =>
                      run(() => bulkApproveTransactions(selectedIds, category))
                    }
                  >
                    {isPending ? "…" : "Approve"}
                  </Button>
                </div>
              </>
            )}

            {mode === "categorize" && (
              <div className="flex items-center gap-2">
                <GroupedCategorySelect
                  value={category}
                  onChange={setCategory}
                  categories={categories}
                  disabled={isPending}
                />
                <Button
                  size="sm"
                  className="h-8 text-xs shrink-0"
                  disabled={isPending || !category}
                  onClick={() =>
                    run(() => bulkCategorizeTransactions(selectedIds, category))
                  }
                >
                  {isPending ? "…" : "Apply"}
                </Button>
              </div>
            )}

            {mode === "move" && (
              <div className="flex items-center gap-2">
                {moveTargets.length === 0 ? (
                  <p className="flex-1 text-xs text-muted-foreground">
                    No other account to move to.
                  </p>
                ) : (
                  <>
                    <select
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      disabled={isPending}
                      className={cn(
                        "flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-1.5 text-sm",
                        "focus:outline-none focus:ring-1 focus:ring-ring",
                      )}
                    >
                      {moveTargets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      className="h-8 text-xs shrink-0"
                      disabled={isPending || !account}
                      onClick={() =>
                        run(() => bulkMoveTransactions(selectedIds, account))
                      }
                    >
                      {isPending ? "…" : "Move"}
                    </Button>
                  </>
                )}
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="text-sm font-medium tabular-nums shrink-0">
            {count} selected
          </span>
          <div className="flex-1 flex items-center justify-end gap-1.5">
            {show.approve && (
              <ActionButton
                active={mode === "approve"}
                disabled={isPending}
                onClick={() => setMode(mode === "approve" ? null : "approve")}
              >
                <Check size={14} /> Approve
              </ActionButton>
            )}
            {show.categorize && (
              <ActionButton
                active={mode === "categorize"}
                disabled={isPending}
                onClick={() =>
                  setMode(mode === "categorize" ? null : "categorize")
                }
              >
                <Tag size={14} /> Categorize
              </ActionButton>
            )}
            {show.move && (
              <ActionButton
                active={mode === "move"}
                disabled={isPending}
                onClick={() => setMode(mode === "move" ? null : "move")}
              >
                <FolderInput size={14} /> Move
              </ActionButton>
            )}
            <button
              type="button"
              aria-label="Clear selection"
              disabled={isPending}
              onClick={() => {
                reset();
                onClearSelection();
              }}
              className="ml-0.5 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground hover:bg-muted/70",
      )}
    >
      {children}
    </button>
  );
}
