import type { QueryKey } from "@tanstack/react-query";
import type { HomeData, PendingTransaction } from "@/lib/budget";
import type { AllTransactionsResponse, AllTransactionsRow } from "@/app/api/transactions/route";
import type { AccountRegisterResponse } from "@/app/api/accounts/[id]/register/route";
import type { ApproveReplace } from "@/app/(app)/transactions/actions";
import type { TransactionDetailResponse } from "./transaction-detail";

// Pure functions that apply a pending transaction write to the cached query
// data it shows up in, so a save can update every list at once instead of
// waiting on the server (see lib/queries/optimistic.ts). Only per-row fields
// are patched; derived budget numbers (activity, available, Ready to Assign)
// are left for the background refetch, since lib/budget/compute.ts is their
// one authority. Each function returns `data` itself when nothing changed.

export type TxnPatch = {
  id: string;
  deleted?: boolean;
  approved?: boolean;
  /** The row's full new category list (edit form). Empty means uncategorized. */
  allocations?: { categoryId: string; name: string; amountCents: number }[];
  /**
   * One category for the row's full amount, applied the way
   * bulkApproveTransactions applies its category: always to an uncategorized
   * row, and to categorized rows as `replace` says ("unsplit": single-category
   * rows too; "all": splits too).
   */
  category?: { id: string; name: string; replace: ApproveReplace };
  payee?: string;
  amountCents?: number;
  txnDate?: string;
  memo?: string | null;
  cleared?: boolean;
  accountId?: string;
  accountName?: string;
};

type Categories = { count: number; categoryId: string | null; label: string | null };

/** Categories after the patch, or null when the patch leaves them as they are. */
function nextCategories(patch: TxnPatch, currentCount: number): Categories | null {
  if (patch.allocations) {
    const n = patch.allocations.length;
    return {
      count: n,
      categoryId: n === 1 ? patch.allocations[0].categoryId : null,
      label: n === 0 ? null : n === 1 ? patch.allocations[0].name : `Split (${n})`,
    };
  }
  if (patch.category) {
    const { id, name, replace } = patch.category;
    const overwrite =
      currentCount === 0 || replace === "all" || (replace === "unsplit" && currentCount <= 1);
    return overwrite ? { count: 1, categoryId: id, label: name } : null;
  }
  return null;
}

/**
 * Approval state after the patch. A bulk or drawer approve of a pending row
 * that would still have no category is a no-op, matching
 * bulkApproveTransactions, which skips it. An edit (which sends its full
 * `allocations`) is taken as-is: the form already applies saveTransaction's
 * rule, under which an off-budget line is approved with no category.
 */
function nextApproved(patch: TxnPatch, approved: boolean, finalCount: number): boolean {
  if (patch.approved === undefined) return approved;
  if (patch.approved && !approved && finalCount === 0 && !patch.allocations) return false;
  return patch.approved;
}

// List rows (All Transactions, account register) label categories as
// "Uncategorized", a category name, or "Split (n)".
const UNCATEGORIZED = "Uncategorized";

function countFromLabel(label: string): number {
  if (label === UNCATEGORIZED) return 0;
  const split = /^Split \((\d+)\)$/.exec(label);
  return split ? Number(split[1]) : 1;
}

type ListRow = Pick<
  AllTransactionsRow,
  | "id"
  | "payee"
  | "amountCents"
  | "txnDate"
  | "approved"
  | "cleared"
  | "memo"
  | "categoryLabel"
  | "suggested"
  | "needsCategory"
>;

function patchListRow<T extends ListRow>(row: T, patch: TxnPatch): T {
  const cats = nextCategories(patch, countFromLabel(row.categoryLabel));
  const count = cats ? cats.count : countFromLabel(row.categoryLabel);
  const approved = nextApproved(patch, row.approved, count);
  return {
    ...row,
    payee: patch.payee ?? row.payee,
    amountCents: patch.amountCents ?? row.amountCents,
    txnDate: patch.txnDate ?? row.txnDate,
    memo: patch.memo !== undefined ? patch.memo : row.memo,
    cleared: patch.cleared ?? row.cleared,
    approved,
    categoryLabel: cats ? (cats.label ?? UNCATEGORIZED) : row.categoryLabel,
    // A category the user picked isn't a suggestion; approved rows never are.
    suggested: !approved && !cats && row.suggested,
    needsCategory: !approved && count === 0,
  };
}

function patchList<T extends ListRow>(
  rows: T[],
  patch: TxnPatch,
  remove: (row: T) => boolean,
  extra?: (row: T) => Partial<T>,
): T[] | null {
  const index = rows.findIndex((row) => row.id === patch.id);
  if (index === -1) return null;
  const row = rows[index];
  if (patch.deleted || remove(row)) return rows.filter((_, i) => i !== index);
  const next = [...rows];
  next[index] = { ...patchListRow(row, patch), ...extra?.(row) };
  return next;
}

function patchPending(pending: PendingTransaction[], patch: TxnPatch): PendingTransaction[] | null {
  const index = pending.findIndex((t) => t.id === patch.id);
  if (index === -1) return null;
  const txn = pending[index];
  const cats = nextCategories(patch, txn.allocationCount);
  const count = cats ? cats.count : txn.allocationCount;
  // Everything on this list is pending: approving it, or deleting it, takes
  // it off.
  if (patch.deleted || nextApproved(patch, false, count)) {
    return pending.filter((_, i) => i !== index);
  }
  const next = [...pending];
  next[index] = {
    ...txn,
    payee: patch.payee ?? txn.payee,
    amountCents: patch.amountCents ?? txn.amountCents,
    txnDate: patch.txnDate ?? txn.txnDate,
    accountName: patch.accountName ?? txn.accountName,
    ...(cats && {
      allocationCount: cats.count,
      categoryId: cats.categoryId,
      categoryLabel: cats.label,
      suggested: false,
    }),
  };
  return next;
}

function patchDetail(
  data: TransactionDetailResponse,
  patch: TxnPatch,
): TransactionDetailResponse {
  const txn = data.txn;
  if (!txn || txn.id !== patch.id) return data;
  if (patch.deleted) return { ...data, txn: null };

  const amountCents = patch.amountCents ?? txn.amountCents;
  const cats = nextCategories(patch, txn.allocations.length);
  const allocations = patch.allocations
    ? patch.allocations.map(({ categoryId, amountCents: cents }) => ({
        categoryId,
        amountCents: cents,
      }))
    : cats && patch.category
      ? [{ categoryId: patch.category.id, amountCents }]
      : txn.allocations;

  return {
    ...data,
    txn: {
      ...txn,
      payee: patch.payee ?? txn.payee,
      txnDate: patch.txnDate ?? txn.txnDate,
      amountCents,
      memo: patch.memo !== undefined ? patch.memo : txn.memo,
      accountId: patch.accountId ?? txn.accountId,
      clearedAt:
        patch.cleared === undefined
          ? txn.clearedAt
          : patch.cleared
            ? (txn.clearedAt ?? new Date().toISOString())
            : null,
      isApproved: nextApproved(patch, txn.isApproved, allocations.length),
      allocations,
      categoryId: cats ? cats.categoryId : txn.categoryId,
      categorySource: cats ? null : txn.categorySource,
    },
  };
}

/**
 * Applies `patch` to one cached ledger query's data, picked by its key
 * (`["ledger", name, ...args]`, see defineQuery). Queries the patch doesn't
 * touch come back unchanged (same reference).
 */
export function patchLedgerData(key: QueryKey, data: unknown, patch: TxnPatch): unknown {
  if (data === undefined || data === null) return data;
  const name = key[1];

  if (name === "home-view") {
    const home = data as HomeData;
    const pending = patchPending(home.pending, patch);
    return pending ? { ...home, pending } : data;
  }

  if (name === "all-transactions") {
    const res = data as AllTransactionsResponse;
    const txns = patchList(res.txns, patch, () => false, (row) => {
      const cats = nextCategories(patch, countFromLabel(row.categoryLabel));
      return {
        accountId: patch.accountId ?? row.accountId,
        accountName: patch.accountName ?? row.accountName,
        categoryIds: !cats
          ? row.categoryIds
          : patch.allocations
            ? patch.allocations.map((a) => a.categoryId)
            : [cats.categoryId!],
      };
    });
    return txns ? { ...res, txns } : data;
  }

  if (name === "account-register") {
    const res = data as AccountRegisterResponse;
    const registerAccountId = key[2];
    // Moved to another account: it leaves this register (the destination's
    // register picks it up on refetch).
    const txns = patchList(
      res.txns,
      patch,
      () => patch.accountId !== undefined && patch.accountId !== registerAccountId,
    );
    return txns ? { ...res, txns } : data;
  }

  if (name === "transaction-detail") {
    return patchDetail(data as TransactionDetailResponse, patch);
  }

  return data;
}

/** Applies several patches in order. */
export function patchLedgerDataAll(key: QueryKey, data: unknown, patches: TxnPatch[]): unknown {
  return patches.reduce((d, patch) => patchLedgerData(key, d, patch), data);
}

/** A patch for runOptimistic that applies `patches` to every cached query. */
export function transactionPatch(patches: TxnPatch[]) {
  return (key: QueryKey, data: unknown) => patchLedgerDataAll(key, data, patches);
}
