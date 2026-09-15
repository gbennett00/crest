"use client";

import { useMemo, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import {
  Check,
  FolderInput,
  MoreHorizontal,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/money";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  bulkApproveTransactions,
  bulkCategorizeTransactions,
  bulkDeleteTransactions,
  bulkMoveTransactions,
  type BulkResult,
} from "@/app/(app)/transactions/actions";
import type {
  AccountOption,
  CategoryOption,
} from "@/components/transactions/transaction-form";

export type BulkAction = "approve" | "categorize" | "move" | "delete";

const ACTION_META: Record<
  BulkAction,
  { label: string; Icon: typeof Check; destructive?: boolean }
> = {
  approve: { label: "Approve", Icon: Check },
  categorize: { label: "Categorize", Icon: Tag },
  move: { label: "Move", Icon: FolderInput },
  delete: { label: "Delete", Icon: Trash2, destructive: true },
};

interface BulkActionsBarProps {
  selectedIds: string[];
  /** Signed sum (cents) of the selected transactions — shown YNAB-style. */
  selectedTotalCents: number;
  /**
   * How many of the selected rows are reconciled (locked). These can be
   * categorized/approved but not moved or deleted, so Move and Delete are
   * disabled once every selected row is locked, and warn otherwise.
   */
  lockedCount?: number;
  categories: CategoryOption[];
  accounts: AccountOption[];
  /** Actions shown as inline buttons on the bar. */
  primary: BulkAction[];
  /** Actions tucked behind the "More" overflow menu. */
  menu?: BulkAction[];
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
  selectedTotalCents,
  lockedCount = 0,
  categories,
  accounts,
  primary,
  menu = [],
  currentAccountId,
  onClearSelection,
}: BulkActionsBarProps) {
  // Which action's picker/dialog is currently open (null = just the bar).
  const [mode, setMode] = useState<BulkAction | null>(null);
  const [category, setCategory] = useState(categories[0]?.id ?? "");
  const moveTargets = useMemo(
    () => accounts.filter((a) => a.id !== currentAccountId),
    [accounts, currentAccountId],
  );
  const [account, setAccount] = useState(moveTargets[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();

  if (selectedIds.length === 0) return null;

  function reset() {
    setMode(null);
    setError(null);
  }

  function run(action: () => Promise<BulkResult>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      invalidateAllLedgerQueries(queryClient);
      reset();
      onClearSelection();
    });
  }

  const count = selectedIds.length;
  // Reconciled rows can't be moved or deleted. How many selected rows those
  // actions could actually touch:
  const eligibleForRestricted = count - lockedCount;
  // Move/Delete are blocked outright only when nothing eligible remains.
  function isBlocked(action: BulkAction) {
    return (
      (action === "move" || action === "delete") && eligibleForRestricted === 0
    );
  }
  const lockHint = "Reconciled transactions can’t be moved or deleted.";

  // The picker row only applies to the non-destructive actions; delete uses a
  // confirmation dialog instead.
  const pickerMode =
    mode === "approve" || mode === "categorize" || mode === "move"
      ? mode
      : null;

  function actionButton(action: BulkAction) {
    const { label, Icon } = ACTION_META[action];
    const active = mode === action;
    const blocked = isBlocked(action);
    return (
      <button
        key={action}
        type="button"
        disabled={isPending || blocked}
        title={blocked ? lockHint : undefined}
        onClick={() => setMode(active ? null : action)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
          active
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground hover:bg-muted/70",
        )}
      >
        <Icon size={14} /> {label}
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-16 md:bottom-4 z-40 flex justify-center px-3 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md rounded-xl border bg-popover shadow-2xl overflow-hidden">
          {/* Picker row (approve / categorize / move) */}
          {pickerMode && (
            <div className="flex flex-col gap-2 px-3 pt-3">
              {pickerMode === "approve" && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Approve {count}. Uncategorized transactions get this
                    category; ones already categorized keep their splits.
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
                        run(() =>
                          bulkApproveTransactions(selectedIds, category),
                        )
                      }
                    >
                      {isPending ? "…" : "Approve"}
                    </Button>
                  </div>
                </>
              )}

              {pickerMode === "categorize" && (
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
                      run(() =>
                        bulkCategorizeTransactions(selectedIds, category),
                      )
                    }
                  >
                    {isPending ? "…" : "Apply"}
                  </Button>
                </div>
              )}

              {pickerMode === "move" && (
                <div className="flex flex-col gap-1.5">
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
                  {lockedCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {lockedCount} reconciled{" "}
                      {lockedCount === 1 ? "line is" : "lines are"} locked and
                      won’t be moved.
                    </p>
                  )}
                </div>
              )}

              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          )}

          {/* Action row */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <div className="flex flex-col shrink-0 leading-tight">
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  selectedTotalCents < 0 && "text-destructive",
                  selectedTotalCents > 0 && "text-green-600 dark:text-green-400",
                )}
              >
                <Money cents={selectedTotalCents} sign />
              </span>
              <span className="text-[11px] text-muted-foreground">
                {count} selected
              </span>
            </div>
            <div className="flex-1 flex items-center justify-end gap-1.5">
              {primary.map((action) => actionButton(action))}

              {menu.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="More actions"
                      disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium bg-muted text-foreground hover:bg-muted/70 transition-colors disabled:opacity-50"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="top">
                    {menu.map((action) => {
                      const { label, Icon, destructive } = ACTION_META[action];
                      const blocked = isBlocked(action);
                      return (
                        <DropdownMenuItem
                          key={action}
                          disabled={blocked}
                          title={blocked ? lockHint : undefined}
                          onSelect={() => setMode(action)}
                          className={cn(
                            destructive &&
                              "text-destructive focus:text-destructive",
                          )}
                        >
                          <Icon size={14} /> {label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
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

      {/* Destructive confirm for delete */}
      <AlertDialog
        open={mode === "delete"}
        onOpenChange={(open) => {
          if (!open && !isPending) reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {eligibleForRestricted} transaction
              {eligibleForRestricted === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {eligibleForRestricted === 1 ? "it" : "them"}{" "}
              from the register. Transfers remove their matching leg too. This
              can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {lockedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {lockedCount} reconciled{" "}
              {lockedCount === 1 ? "line is" : "lines are"} locked and will be
              kept.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                // Keep the dialog open until the action resolves.
                e.preventDefault();
                run(() => bulkDeleteTransactions(selectedIds));
              }}
            >
              {isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
