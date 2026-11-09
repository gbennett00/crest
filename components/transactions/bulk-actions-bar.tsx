"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import { CategoryPicker } from "@/components/transactions/category-picker";
import { afterNextPaint, startFlow } from "@/lib/perf";

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
  /**
   * How many of the selected rows have no category yet. When none do, Approve
   * approves them as-is (keeping their categories, suggested or not) without
   * asking for a category. Omit when unknown: Approve then always asks.
   */
  uncategorizedCount?: number;
  /**
   * Home's single-Approve flow: when some rows need a category, the one
   * chosen is applied to every selected row (suggestions included; real
   * splits keep theirs) instead of only the uncategorized ones.
   */
  approveAppliesToAll?: boolean;
  /** Category to prefill when Approve asks for one (e.g. every suggestion agrees). */
  approvePrefillCategoryId?: string | null;
  /** With `approveAppliesToAll`: selected rows that are real splits (they keep them). */
  approveSplitCount?: number;
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

/** Explains what bulk-approving with a chosen category will do. */
function approvePrompt(
  count: number,
  uncategorized: number | undefined,
  appliesToAll: boolean,
  splitCount: number,
): string {
  if (appliesToAll) {
    if (splitCount > 0) {
      const applied = count - splitCount;
      return (
        `This category will be applied to ${applied === 1 ? "1 transaction" : `${applied} transactions`}. ` +
        `${splitCount === 1 ? "The split one keeps its" : `The ${splitCount} split ones keep their`} splits.`
      );
    }
    return `This category will be applied to ${count === 1 ? "this transaction" : `all ${count} transactions`}.`;
  }
  if (uncategorized === undefined) {
    return `Approve ${count}. Uncategorized transactions get this category; ones already categorized keep theirs.`;
  }
  if (uncategorized === count) {
    return `Approve ${count}. Choose a category for ${count === 1 ? "it" : "them"}.`;
  }
  const kept = count - uncategorized;
  return (
    `Approve ${count}. ${kept} already categorized ${kept === 1 ? "keeps its category" : "keep their categories"}; ` +
    `choose one for the ${uncategorized} uncategorized.`
  );
}

export function BulkActionsBar({
  selectedIds,
  selectedTotalCents,
  lockedCount = 0,
  uncategorizedCount,
  approveAppliesToAll = false,
  approvePrefillCategoryId = null,
  approveSplitCount = 0,
  categories,
  accounts,
  primary,
  menu = [],
  currentAccountId,
  onClearSelection,
}: BulkActionsBarProps) {
  // Which action's picker/dialog is currently open (null = just the bar).
  const [mode, setMode] = useState<BulkAction | null>(null);
  // No default category: pre-selecting the first option (Ready to Assign) made
  // a bulk action look like it would send everything there.
  const [category, setCategory] = useState("");
  // Set once the user picks in the Approve panel; from then on the prefill
  // never overwrites their choice.
  const [categoryTouched, setCategoryTouched] = useState(false);
  const moveTargets = useMemo(
    () => accounts.filter((a) => a.id !== currentAccountId),
    [accounts, currentAccountId],
  );
  const [account, setAccount] = useState(moveTargets[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();

  // Keep the Approve picker's prefill in step with the selection while open,
  // until the user picks a category themselves.
  useEffect(() => {
    if (mode === "approve" && !categoryTouched) setCategory(approvePrefillCategoryId ?? "");
  }, [mode, approvePrefillCategoryId, categoryTouched]);

  if (selectedIds.length === 0) return null;

  function reset() {
    setMode(null);
    setError(null);
    setCategoryTouched(false);
  }

  function run(kind: BulkAction, action: () => Promise<BulkResult>) {
    setError(null);
    // Times tap → server action returned → refetch landed → repainted, i.e.
    // how long the selected rows linger (docs/instant-feel-plan.md, Phase 0).
    const flow = startFlow(`bulk-${kind}`, { count: selectedIds.length });
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      flow.step("action");
      invalidateAllLedgerQueries(queryClient)
        .then(() => {
          flow.step("refetch");
          return afterNextPaint();
        })
        .then(() => flow.step("painted"));
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

  // Every selected row is already categorized: approving needs no category,
  // so do it in one tap — each row keeps the category it has.
  const approveAsIs = uncategorizedCount === 0;

  function approveWithCategory() {
    if (!category) return;
    run("approve", () =>
      bulkApproveTransactions(selectedIds, category, {
        replace: approveAppliesToAll ? "unsplit" : "none",
      }),
    );
  }

  function openAction(action: BulkAction, toggle: boolean) {
    if (action === "approve" && approveAsIs) {
      run("approve", () => bulkApproveTransactions(selectedIds, null));
      return;
    }
    // Approve's panel is open: the bar's Approve button is the one that commits.
    if (action === "approve" && mode === "approve") {
      approveWithCategory();
      return;
    }
    setMode(toggle && mode === action ? null : action);
  }

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
        disabled={
          isPending || blocked || (action === "approve" && active && !approveAsIs && !category)
        }
        title={blocked ? lockHint : undefined}
        onClick={() => openAction(action, true)}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-ds-md px-3 text-[15px] font-semibold leading-5 transition-colors disabled:opacity-40",
          active || action === "approve"
            ? "bg-brand text-brand-ink hover:brightness-95"
            : "border border-border-strong bg-surface-raised text-ink hover:bg-surface-sunken",
        )}
      >
        <Icon size={18} /> {label}
        {action === "approve" && count > 1 ? ` ${count}` : ""}
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-[calc(var(--dock-bottom)+6.25rem)] md:bottom-4 z-40 flex justify-center px-3 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md overflow-hidden rounded-ds-lg border bg-surface-raised text-ink shadow-float">
          {/* Picker row (approve / categorize / move) */}
          {pickerMode && (
            <div className="flex flex-col gap-2 px-3 pt-3">
              {pickerMode === "approve" && (
                <>
                  <div className="flex items-start gap-2">
                    <p className="flex-1 pt-1.5 text-caption text-ink-muted">
                      {approveAsIs
                        ? // The selection became all-categorized while the panel was open.
                          `Approve ${count} with ${count === 1 ? "its" : "their"} current ${count === 1 ? "category" : "categories"}.`
                        : approvePrompt(count, uncategorizedCount, approveAppliesToAll, approveSplitCount)}
                    </p>
                    <button
                      type="button"
                      aria-label="Close approve options"
                      disabled={isPending}
                      onClick={reset}
                      className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-ds-md text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  {!approveAsIs && (
                    <CategoryPicker
                      value={category}
                      onChange={(id) => {
                        setCategory(id);
                        setCategoryTouched(true);
                      }}
                      categories={categories}
                      placeholder="Choose a category…"
                      disabled={isPending}
                      className="h-12 w-full rounded-ds-md border-border-strong bg-surface-sunken text-body text-ink"
                    />
                  )}
                </>
              )}

              {pickerMode === "categorize" && (
                <div className="flex items-center gap-2">
                  <CategoryPicker
                    value={category}
                    onChange={setCategory}
                    categories={categories}
                    disabled={isPending}
                    className="flex-1 min-w-0"
                  />
                  <Button
                    size="sm"
                    className="shrink-0"
                    disabled={isPending || !category}
                    onClick={() =>
                      run("categorize", () =>
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
                      <p className="flex-1 text-caption text-ink-muted">
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
                          className="shrink-0"
                          disabled={isPending || !account}
                          onClick={() =>
                            run("move", () => bulkMoveTransactions(selectedIds, account))
                          }
                        >
                          {isPending ? "…" : "Move"}
                        </Button>
                      </>
                    )}
                  </div>
                  {lockedCount > 0 && (
                    <p className="text-caption text-ink-muted">
                      {lockedCount} reconciled{" "}
                      {lockedCount === 1 ? "line is" : "lines are"} locked and
                      won’t be moved.
                    </p>
                  )}
                </div>
              )}

              {error && <p className="text-caption text-neg-text">{error}</p>}
            </div>
          )}

          {/* Action row */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <div className="flex flex-col shrink-0 leading-tight">
              <span
                className={cn(
                  "num text-amount",
                  selectedTotalCents < 0 && "text-neg-text",
                  selectedTotalCents > 0 && "text-pos-text",
                )}
              >
                <Money cents={selectedTotalCents} sign />
              </span>
              <span className="text-caption text-ink-muted">
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
                      className="inline-flex h-9 w-9 items-center justify-center rounded-ds-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
                    >
                      <MoreHorizontal size={20} />
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
                          onSelect={() => openAction(action, false)}
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
                className="ml-0.5 flex h-9 w-9 items-center justify-center rounded-ds-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
              >
                <X size={20} />
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
            <p className="text-caption text-ink-muted">
              {lockedCount} reconciled{" "}
              {lockedCount === 1 ? "line is" : "lines are"} locked and will be
              kept.
            </p>
          )}
          {error && <p className="text-caption text-neg-text">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                // Keep the dialog open until the action resolves.
                e.preventDefault();
                run("delete", () => bulkDeleteTransactions(selectedIds));
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
