"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CountBadge } from "@/components/ui/count-badge";
import { Sheet } from "@/components/ui/sheet";
import { TransactionRow } from "@/components/ui/transaction-row";
import { Amount } from "@/components/ui/amount";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CategoryPicker } from "@/components/transactions/category-picker";
import type { CategoryOption } from "@/components/transactions/transaction-form";
import { useFormattedCents } from "@/components/money";
import { formatMonthDay } from "@/lib/format";
import { invalidateAllLedgerQueries } from "@/lib/queries/define-query";
import type { PendingTransaction } from "@/lib/budget/load-home-view";
import {
  approvalTargets,
  approveLabel,
  approvedMessage,
  reviewSummary,
  selectedCount,
  splitByCategory,
} from "@/lib/review";
import {
  bulkApproveTransactions,
  bulkDeleteTransactions,
  bulkUnapproveTransactions,
} from "@/app/(app)/transactions/actions";

type Toast = { ids: string[]; clearIds: string[]; message: string };

const TOAST_MS = 8000;

/**
 * The Review drawer on Home: a tall Sheet listing the transactions waiting for
 * approval, with checkboxes always visible.
 *
 * Approve is one action. With nothing selected it acts on every row ("Approve
 * all 10"), otherwise on the selection. If every row it acts on already has a
 * category it approves straight away and shows an Undo toast. If any row is
 * uncategorized the drawer swaps in place to a category step (back chevron,
 * never a stacked sheet). After approving, the drawer stays open on what is
 * left, and closes once nothing is.
 */
export function ReviewDrawer({
  open,
  onOpenChange,
  pending,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: PendingTransaction[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const formatCents = useFormattedCents();
  const [isPending, startTransition] = useTransition();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"list" | "category">("list");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rows = pending;
  const hasSelection = selectedCount(rows, selected) > 0;
  const targets = approvalTargets(rows, selected);
  const { uncategorized, categorized } = splitByCategory(targets);
  const allSelected = rows.length > 0 && selectedCount(rows, selected) === rows.length;

  // Reset the in-progress state whenever the drawer closes.
  useEffect(() => {
    if (open) return;
    setStep("list");
    setCategoryId("");
    setSelected(new Set());
    setError(null);
  }, [open]);

  // Nothing left to review: close.
  useEffect(() => {
    if (open && rows.length === 0 && !isPending) onOpenChange(false);
  }, [open, rows.length, isPending, onOpenChange]);

  // A toast dismisses itself.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  function approve(category: string | null) {
    const ids = targets.map((t) => t.id);
    const clearIds = uncategorized.map((t) => t.id);
    setError(null);
    startTransition(async () => {
      const result = await bulkApproveTransactions(ids, category);
      if (result.error) {
        setError(result.error);
        return;
      }
      await invalidateAllLedgerQueries(queryClient);
      setSelected(new Set());
      setStep("list");
      setCategoryId("");
      if (result.skipped > 0) {
        setError(`${result.skipped} couldn’t be approved.`);
      }
      if (result.updated > 0) {
        setToast({ ids, clearIds, message: approvedMessage(result.updated) });
      }
    });
  }

  function onApprove() {
    // Everything already has a category: approve as-is, no second step.
    if (uncategorized.length === 0) approve(null);
    else setStep("category");
  }

  function undo() {
    if (!toast) return;
    const { ids, clearIds } = toast;
    setToast(null);
    startTransition(async () => {
      const result = await bulkUnapproveTransactions(ids, clearIds);
      if (result.error) setError(result.error);
      await invalidateAllLedgerQueries(queryClient);
    });
  }

  function deleteSelected() {
    const ids = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    setConfirmDelete(false);
    startTransition(async () => {
      const result = await bulkDeleteTransactions(ids);
      if (result.error) setError(result.error);
      await invalidateAllLedgerQueries(queryClient);
      setSelected(new Set());
    });
  }

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const caption = (t: PendingTransaction) => `${formatMonthDay(t.txnDate)} · ${t.accountName}`;
  const categoryName = categories.find((c) => c.id === categoryId)?.name ?? null;

  const toastEl = toast && (
    <UndoToast
      message={toast.message}
      onUndo={undo}
      className={
        open
          ? "absolute inset-x-4 bottom-24"
          : "fixed inset-x-4 bottom-[calc(var(--dock-bottom)+6.25rem)]"
      }
    />
  );

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        tall
        title={
          step === "list" ? (
            <span className="flex items-center gap-2">
              Review
              {rows.length > 0 && <CountBadge>{rows.length}</CountBadge>}
            </span>
          ) : (
            approveLabel(targets.length, true)
          )
        }
        onBack={step === "category" ? () => setStep("list") : undefined}
        className="p-0"
        overlay={open ? toastEl : null}
        footer={
          step === "list" ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="More actions"
                    disabled={isPending}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top">
                  <DropdownMenuItem
                    disabled={selectedRows.length !== 1}
                    onSelect={() => router.push(`/transactions/${selectedRows[0]?.id}?back=/`)}
                  >
                    <Pencil size={14} /> Open
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={selectedRows.length === 0}
                    onSelect={() => setConfirmDelete(true)}
                    className="text-neg-text"
                  >
                    <Trash2 size={14} /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                className="flex-1"
                disabled={isPending || rows.length === 0}
                onClick={onApprove}
              >
                {isPending ? "Approving…" : approveLabel(targets.length, hasSelection)}
              </Button>
            </>
          ) : (
            <Button
              className="flex-1"
              disabled={isPending || !categoryId}
              onClick={() => approve(categoryId)}
            >
              {isPending ? "Approving…" : approveLabel(targets.length, true)}
            </Button>
          )
        }
      >
        {step === "list" ? (
          <>
            <div className="sticky top-0 z-10 flex h-12 items-center gap-3 border-y bg-surface-sunken px-4">
              <Checkbox
                checked={allSelected ? true : hasSelection ? "indeterminate" : false}
                onCheckedChange={toggleAll}
                aria-label="Select all"
              />
              <span className="flex-1 text-body">Select all</span>
              <span className="num text-caption text-ink-muted">
                {reviewSummary(rows, selected, formatCents)}
              </span>
            </div>
            <div>
              {rows.map((t) => (
                <TransactionRow
                  key={t.id}
                  leading="check"
                  payee={t.payee}
                  caption={caption(t)}
                  amountCents={t.amountCents}
                  category={t.categoryLabel}
                  suggested={t.suggested}
                  checked={selected.has(t.id)}
                  onCheckedChange={(on) => toggle(t.id, on)}
                />
              ))}
            </div>
            {error && <p className="px-5 py-3 text-caption text-neg-text">{error}</p>}
          </>
        ) : (
          <div className="px-5 pb-4">
            <p className="mb-2 mt-4 text-overline uppercase text-ink-muted">Will be categorized</p>
            {uncategorized.map((t) => (
              <div key={t.id} className="flex min-h-[60px] items-center gap-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-strong">{t.payee}</p>
                  <p className="num text-caption text-ink-muted">
                    <span className="text-neg-text">
                      <Amount cents={t.amountCents} basePx={13} className="text-caption" />
                    </span>{" "}
                    · {formatMonthDay(t.txnDate)}
                  </p>
                </div>
                {categoryName && (
                  <span className="inline-flex min-h-8 max-w-[45%] items-center rounded-pill bg-brand-subtle px-3 text-pill text-brand-text">
                    <span className="truncate">{categoryName}</span>
                  </span>
                )}
              </div>
            ))}

            {categorized.length > 0 && (
              <>
                <p className="mb-2 mt-4 text-overline uppercase text-ink-muted">
                  Keeps its category
                </p>
                {categorized.map((t) => (
                  <div key={t.id} className="flex min-h-[60px] items-center gap-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-strong">{t.payee}</p>
                      <p className="num text-caption text-ink-muted">
                        <span className="text-neg-text">
                          <Amount cents={t.amountCents} basePx={13} className="text-caption" />
                        </span>{" "}
                        · {formatMonthDay(t.txnDate)}
                      </p>
                    </div>
                    <span className="inline-flex min-h-8 max-w-[45%] items-center rounded-pill bg-surface-sunken px-3 text-pill text-ink-muted">
                      <span className="truncate">{t.categoryLabel}</span>
                    </span>
                  </div>
                ))}
              </>
            )}

            <p className="mb-2 mt-5 text-caption text-ink-muted">Category for uncategorized</p>
            <CategoryPicker
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              placeholder="Choose a category…"
              disabled={isPending}
              className="min-h-14 rounded-ds-md border-border-strong bg-surface-sunken px-4 text-body"
            />
            {error && <p className="mt-3 text-caption text-neg-text">{error}</p>}
          </div>
        )}
      </Sheet>

      {/* With the drawer closed the toast stands alone (no dialog blocks it). */}
      {!open && toastEl}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedRows.length} transaction{selectedRows.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>This can’t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteSelected}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function UndoToast({
  message,
  onUndo,
  className,
}: {
  message: string;
  onUndo: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "z-[70] mx-auto flex max-w-md items-center gap-3 rounded-ds-md bg-ink py-1 pl-4 pr-2 text-bg shadow-float",
        className,
      )}
    >
      <span className="flex-1 text-body-strong">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="min-h-tap px-3 text-body-strong underline underline-offset-4"
      >
        Undo
      </button>
    </div>
  );
}
