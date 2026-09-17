import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateTransactionInput } from "@/lib/ledger";

// --- Module mocks -----------------------------------------------------------
// next/cache: revalidatePath is a no-op in the test environment.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Supabase server client: loadBulkTxns() does
//   supabase.from("transactions").select(...).in("id", ids)
// so `.in()` must resolve to { data, error }. `mockRows` is swapped per test.
let mockRows: unknown[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: mockRows, error: null }),
      }),
    }),
  })),
}));

// Ledger: keep the real LedgerError, spy on the write path. The spies are
// created via vi.hoisted so they exist before the hoisted vi.mock factory runs.
const { updateTransaction, deleteTransactionWithCounterpart } = vi.hoisted(() => ({
  updateTransaction:
    vi.fn<(client: unknown, input: UpdateTransactionInput) => Promise<unknown>>(),
  deleteTransactionWithCounterpart:
    vi.fn<(client: unknown, id: string) => Promise<void>>(),
}));
vi.mock("@/lib/ledger", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ledger")>();
  return { ...actual, updateTransaction, deleteTransactionWithCounterpart };
});

import { LedgerError } from "@/lib/ledger";
import {
  bulkApproveTransactions,
  bulkCategorizeTransactions,
  bulkDeleteTransactions,
  bulkMoveTransactions,
} from "./actions";

type Row = {
  id: string;
  amount_cents: number;
  approved_at: string | null;
  reconciled_at: string | null;
  transfer_account_id: string | null;
  transaction_allocations: { category_id: string; amount_cents: number }[];
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "txn-1",
    amount_cents: -5000,
    approved_at: null,
    reconciled_at: null,
    transfer_account_id: null,
    transaction_allocations: [],
    ...overrides,
  };
}

beforeEach(() => {
  updateTransaction.mockClear();
  deleteTransactionWithCounterpart.mockReset();
  mockRows = [];
});

// ---------------------------------------------------------------------------
// bulkApproveTransactions
// ---------------------------------------------------------------------------

describe("bulkApproveTransactions", () => {
  it("returns early with no work for an empty id list", async () => {
    const res = await bulkApproveTransactions([], "cat-1");
    expect(res).toEqual({ updated: 0, skipped: 0 });
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it("applies the fallback category to an uncategorized line and approves it", async () => {
    mockRows = [row({ id: "a", amount_cents: -5000 })];
    const res = await bulkApproveTransactions(["a"], "cat-9");

    expect(res).toEqual({ updated: 1, skipped: 0 });
    expect(updateTransaction).toHaveBeenCalledTimes(1);
    const arg = updateTransaction.mock.calls[0][1];
    expect(arg).toMatchObject({
      id: "a",
      allocations: [{ categoryId: "cat-9", amountCents: -5000 }],
    });
    expect(arg.approvedAt).toBeTruthy();
  });

  it("keeps existing splits that already cover the amount", async () => {
    mockRows = [
      row({
        id: "b",
        amount_cents: -5000,
        transaction_allocations: [
          { category_id: "cat-1", amount_cents: -2000 },
          { category_id: "cat-2", amount_cents: -3000 },
        ],
      }),
    ];
    const res = await bulkApproveTransactions(["b"], "cat-9");

    expect(res).toEqual({ updated: 1, skipped: 0 });
    const arg = updateTransaction.mock.calls[0][1];
    expect(arg.allocations).toEqual([
      { categoryId: "cat-1", amountCents: -2000 },
      { categoryId: "cat-2", amountCents: -3000 },
    ]);
  });

  it("falls back to the chosen category when existing splits don't cover the amount", async () => {
    mockRows = [
      row({
        id: "c",
        amount_cents: -5000,
        transaction_allocations: [{ category_id: "cat-1", amount_cents: -2000 }],
      }),
    ];
    await bulkApproveTransactions(["c"], "cat-9");
    const arg = updateTransaction.mock.calls[0][1];
    expect(arg.allocations).toEqual([{ categoryId: "cat-9", amountCents: -5000 }]);
  });

  it("skips an uncategorized line when no fallback category is supplied", async () => {
    mockRows = [row({ id: "d" })];
    const res = await bulkApproveTransactions(["d"], null);
    expect(res).toEqual({ updated: 0, skipped: 1 });
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it("approves reconciled (locked) lines — locking doesn't block categorization", async () => {
    mockRows = [row({ id: "e", reconciled_at: "2026-01-01T00:00:00Z" })];
    const res = await bulkApproveTransactions(["e"], "cat-9");
    expect(res).toEqual({ updated: 1, skipped: 0 });
    expect(updateTransaction.mock.calls[0][1]).toMatchObject({
      id: "e",
      allocations: [{ categoryId: "cat-9", amountCents: -5000 }],
    });
  });

  it("skips an already-approved transfer leg (no category to approve into)", async () => {
    mockRows = [
      row({
        id: "t",
        transfer_account_id: "acc-2",
        approved_at: "2026-01-01T00:00:00Z",
      }),
    ];
    const res = await bulkApproveTransactions(["t"], "cat-9");
    expect(res).toEqual({ updated: 0, skipped: 1 });
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it("does not skip a still-pending transfer leg — the on-budget side of a mixed transfer needs a category like any other pending line", async () => {
    mockRows = [
      row({ id: "t", transfer_account_id: "acc-2", approved_at: null }),
    ];
    const res = await bulkApproveTransactions(["t"], "cat-9");
    expect(res).toEqual({ updated: 1, skipped: 0 });
    expect(updateTransaction.mock.calls[0][1]).toMatchObject({
      id: "t",
      allocations: [{ categoryId: "cat-9", amountCents: -5000 }],
    });
  });
});

// ---------------------------------------------------------------------------
// bulkCategorizeTransactions
// ---------------------------------------------------------------------------

describe("bulkCategorizeTransactions", () => {
  it("requires a category", async () => {
    const res = await bulkCategorizeTransactions(["a"], "");
    expect(res.error).toBeTruthy();
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it("assigns the category as a single full-amount split without touching approval", async () => {
    mockRows = [row({ id: "a", amount_cents: -1200, approved_at: null })];
    const res = await bulkCategorizeTransactions(["a"], "cat-3");

    expect(res).toEqual({ updated: 1, skipped: 0 });
    const arg = updateTransaction.mock.calls[0][1];
    expect(arg).toEqual({
      id: "a",
      allocations: [{ categoryId: "cat-3", amountCents: -1200 }],
    });
    // approvedAt is not part of the patch — approval state is left as-is.
    expect(arg.approvedAt).toBeUndefined();
  });

  it("categorizes reconciled lines but skips an already-approved transfer leg", async () => {
    mockRows = [
      row({
        id: "a",
        transfer_account_id: "acc-2",
        approved_at: "2026-01-01T00:00:00Z",
      }),
      row({ id: "b", amount_cents: -1200, reconciled_at: "2026-01-01T00:00:00Z" }),
    ];
    const res = await bulkCategorizeTransactions(["a", "b"], "cat-3");
    expect(res).toEqual({ updated: 1, skipped: 1 });
    expect(updateTransaction).toHaveBeenCalledTimes(1);
    expect(updateTransaction.mock.calls[0][1]).toEqual({
      id: "b",
      allocations: [{ categoryId: "cat-3", amountCents: -1200 }],
    });
  });

  it("categorizes a still-pending transfer leg — the on-budget side of a mixed transfer", async () => {
    mockRows = [
      row({ id: "a", transfer_account_id: "acc-2", approved_at: null }),
    ];
    const res = await bulkCategorizeTransactions(["a"], "cat-3");
    expect(res).toEqual({ updated: 1, skipped: 0 });
    expect(updateTransaction.mock.calls[0][1]).toEqual({
      id: "a",
      allocations: [{ categoryId: "cat-3", amountCents: -5000 }],
    });
  });
});

// ---------------------------------------------------------------------------
// bulkMoveTransactions
// ---------------------------------------------------------------------------

describe("bulkMoveTransactions", () => {
  it("requires a target account", async () => {
    const res = await bulkMoveTransactions(["a"], "");
    expect(res.error).toBeTruthy();
    expect(updateTransaction).not.toHaveBeenCalled();
  });

  it("moves an ordinary line to the target account", async () => {
    mockRows = [row({ id: "a" })];
    const res = await bulkMoveTransactions(["a"], "acc-9");
    expect(res).toEqual({ updated: 1, skipped: 0 });
    expect(updateTransaction.mock.calls[0][1]).toEqual({
      id: "a",
      accountId: "acc-9",
    });
  });

  it("skips transfer legs (moving one side would orphan its mirror)", async () => {
    mockRows = [
      row({ id: "a", transfer_account_id: "acc-2" }),
      row({ id: "b" }),
    ];
    const res = await bulkMoveTransactions(["a", "b"], "acc-9");
    expect(res).toEqual({ updated: 1, skipped: 1 });
    expect(updateTransaction).toHaveBeenCalledTimes(1);
    expect(updateTransaction.mock.calls[0][1]).toMatchObject({ id: "b" });
  });

  it("skips reconciled lines", async () => {
    mockRows = [row({ id: "a", reconciled_at: "2026-01-01T00:00:00Z" })];
    const res = await bulkMoveTransactions(["a"], "acc-9");
    expect(res).toEqual({ updated: 0, skipped: 1 });
  });
});

// ---------------------------------------------------------------------------
// bulkDeleteTransactions
// ---------------------------------------------------------------------------

describe("bulkDeleteTransactions", () => {
  it("returns early with no work for an empty id list", async () => {
    const res = await bulkDeleteTransactions([]);
    expect(res).toEqual({ updated: 0, skipped: 0 });
    expect(deleteTransactionWithCounterpart).not.toHaveBeenCalled();
  });

  it("deletes each selected line (transfer legs via the counterpart-aware op)", async () => {
    deleteTransactionWithCounterpart.mockResolvedValue(undefined);
    mockRows = [row({ id: "a" }), row({ id: "b", transfer_account_id: "acc-2" })];
    const res = await bulkDeleteTransactions(["a", "b"]);
    expect(res).toEqual({ updated: 2, skipped: 0 });
    expect(deleteTransactionWithCounterpart).toHaveBeenCalledTimes(2);
    expect(deleteTransactionWithCounterpart.mock.calls.map((c) => c[1])).toEqual([
      "a",
      "b",
    ]);
  });

  it("skips reconciled (locked) lines", async () => {
    deleteTransactionWithCounterpart.mockResolvedValue(undefined);
    mockRows = [
      row({ id: "a", reconciled_at: "2026-01-01T00:00:00Z" }),
      row({ id: "b" }),
    ];
    const res = await bulkDeleteTransactions(["a", "b"]);
    expect(res).toEqual({ updated: 1, skipped: 1 });
    expect(deleteTransactionWithCounterpart).toHaveBeenCalledTimes(1);
    expect(deleteTransactionWithCounterpart.mock.calls[0][1]).toBe("b");
  });

  it("counts an already-gone counterpart leg as deleted, not a failure", async () => {
    // Both legs selected: deleting the first removes the second, so the second
    // reaches deleteTransactionWithCounterpart as not_found.
    deleteTransactionWithCounterpart
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new LedgerError("not_found", "transaction not found"));
    mockRows = [
      row({ id: "a", transfer_account_id: "acc-2" }),
      row({ id: "b", transfer_account_id: "acc-1" }),
    ];
    const res = await bulkDeleteTransactions(["a", "b"]);
    expect(res).toEqual({ updated: 2, skipped: 0 });
  });

  it("surfaces a real ledger error", async () => {
    deleteTransactionWithCounterpart.mockRejectedValue(
      new LedgerError("db_error", "boom"),
    );
    mockRows = [row({ id: "a" })];
    const res = await bulkDeleteTransactions(["a"]);
    expect(res.error).toBe("boom");
    expect(res.updated).toBe(0);
  });
});
