import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  bulkUpsertCategoryBudgets,
  bulkUpsertTransactions,
  createAccount,
  createTransaction,
  createTransfer,
  deleteTransactionWithCounterpart,
  reconcileWithAdjustment,
  reconcileWithRegisterBalance,
  updateTransaction,
  upsertTransaction,
} from "./operations";
import { RECONCILIATION_ADJUSTMENT_PAYEE } from "./constants";
import type { TransactionRow } from "./types";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

// A Proxy that satisfies any Supabase chain depth. Only single() is terminal;
// everything else returns the proxy so arbitrary chains compose freely.
// maybeSingle() returns no existing row (used by upsertTransaction lookup).
function makeMockClient(fetchRow: TransactionRow | null = null): SupabaseClient {
  const singleFn = vi.fn().mockResolvedValue({ data: fetchRow, error: null });

  const proxy: Record<string, unknown> = new Proxy({} as Record<string, unknown>, {
    get(_, prop) {
      if (prop === "single") return singleFn;
      if (prop === "maybeSingle")
        return vi.fn().mockResolvedValue({ data: null, error: null });
      return () => proxy;
    },
  });

  return {
    from: vi.fn(() => proxy),
    rpc: vi.fn().mockResolvedValue({ error: null }),
  } as unknown as SupabaseClient;
}

function txnRow(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: "txn-1",
    account_id: "acc-1",
    amount_cents: -5000,
    txn_date: "2026-01-15",
    payee: "Grocery Store",
    memo: null,
    transfer_account_id: null,
    imported_id: null,
    approved_at: null,
    cleared_at: null,
    reconciled_at: null,
    created_at: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

const APPROVED_AT = "2026-01-15T10:00:00Z";
const ALLOCS_OK = [{ categoryId: "cat-1", amountCents: -5000 }];

// ---------------------------------------------------------------------------
// createTransaction — split enforcement (validation fires before any DB call)
// ---------------------------------------------------------------------------

describe("createTransaction — split enforcement", () => {
  it("rejects approved transaction with no allocations", async () => {
    await expect(
      createTransaction(null as unknown as SupabaseClient, {
        accountId: "acc-1",
        amountCents: -5000,
        txnDate: "2026-01-15",
        approvedAt: APPROVED_AT,
      }),
    ).rejects.toMatchObject({ code: "allocations_required" });
  });

  it("rejects approved transaction when split sum differs from amount", async () => {
    await expect(
      createTransaction(null as unknown as SupabaseClient, {
        accountId: "acc-1",
        amountCents: -5000,
        txnDate: "2026-01-15",
        approvedAt: APPROVED_AT,
        allocations: [{ categoryId: "cat-1", amountCents: -4000 }],
      }),
    ).rejects.toMatchObject({ code: "split_sum_mismatch" });
  });

  it("accepts unapproved transaction with no allocations", async () => {
    const client = makeMockClient(txnRow());
    await expect(
      createTransaction(client, {
        accountId: "acc-1",
        amountCents: -5000,
        txnDate: "2026-01-15",
      }),
    ).resolves.toBeDefined();
  });

  it("accepts inflow transaction with matching positive split", async () => {
    const client = makeMockClient(txnRow({ amount_cents: 10000, approved_at: APPROVED_AT }));
    await expect(
      createTransaction(client, {
        accountId: "acc-1",
        amountCents: 10000,
        txnDate: "2026-01-15",
        approvedAt: APPROVED_AT,
        allocations: [{ categoryId: "cat-rta", amountCents: 10000 }],
      }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// upsertTransaction — split enforcement (validation fires before DB lookup)
// ---------------------------------------------------------------------------

describe("upsertTransaction — split enforcement", () => {
  it("rejects approved import with no allocations", async () => {
    await expect(
      upsertTransaction(null as unknown as SupabaseClient, {
        accountId: "acc-1",
        importedId: "plaid-123",
        amountCents: -5000,
        txnDate: "2026-01-15",
        approvedAt: APPROVED_AT,
      }),
    ).rejects.toMatchObject({ code: "allocations_required" });
  });

  it("rejects approved import when split sum differs from amount", async () => {
    await expect(
      upsertTransaction(null as unknown as SupabaseClient, {
        accountId: "acc-1",
        importedId: "plaid-123",
        amountCents: -5000,
        txnDate: "2026-01-15",
        approvedAt: APPROVED_AT,
        allocations: [{ categoryId: "cat-1", amountCents: -3000 }],
      }),
    ).rejects.toMatchObject({ code: "split_sum_mismatch" });
  });
});

// ---------------------------------------------------------------------------
// updateTransaction — conditional split enforcement
// ---------------------------------------------------------------------------

describe("updateTransaction — conditional split enforcement", () => {
  it("requires allocations when approving for the first time", async () => {
    const client = makeMockClient(txnRow({ approved_at: null }));
    await expect(
      updateTransaction(client, { id: "txn-1", approvedAt: APPROVED_AT }),
    ).rejects.toMatchObject({ code: "allocations_required" });
  });

  it("rejects mismatched split sum when approving for the first time", async () => {
    const client = makeMockClient(txnRow({ approved_at: null }));
    await expect(
      updateTransaction(client, {
        id: "txn-1",
        approvedAt: APPROVED_AT,
        allocations: [{ categoryId: "cat-1", amountCents: -3000 }],
      }),
    ).rejects.toMatchObject({ code: "split_sum_mismatch" });
  });

  it("succeeds when allocations match amount on approval", async () => {
    const client = makeMockClient(txnRow({ approved_at: null }));
    await expect(
      updateTransaction(client, {
        id: "txn-1",
        approvedAt: APPROVED_AT,
        allocations: ALLOCS_OK,
      }),
    ).resolves.toBeDefined();
  });

  it("requires allocations when changing amount on already-approved transaction", async () => {
    const client = makeMockClient(txnRow({ approved_at: APPROVED_AT }));
    await expect(
      updateTransaction(client, { id: "txn-1", amountCents: -8000 }),
    ).rejects.toMatchObject({ code: "allocations_required" });
  });

  it("rejects mismatched splits when changing amount on already-approved transaction", async () => {
    const client = makeMockClient(txnRow({ approved_at: APPROVED_AT }));
    await expect(
      updateTransaction(client, {
        id: "txn-1",
        amountCents: -8000,
        allocations: [{ categoryId: "cat-1", amountCents: -5000 }],
      }),
    ).rejects.toMatchObject({ code: "split_sum_mismatch" });
  });

  it("does not require allocations for payee/memo edit on approved transaction", async () => {
    const client = makeMockClient(txnRow({ approved_at: APPROVED_AT }));
    await expect(
      updateTransaction(client, { id: "txn-1", payee: "New Store Name" }),
    ).resolves.toBeDefined();
  });

  it("does not require allocations when un-approving", async () => {
    const client = makeMockClient(txnRow({ approved_at: APPROVED_AT }));
    await expect(
      updateTransaction(client, { id: "txn-1", approvedAt: null }),
    ).resolves.toBeDefined();
  });

  it("rejects clearing all allocations on still-approved transaction", async () => {
    const client = makeMockClient(txnRow({ approved_at: APPROVED_AT }));
    await expect(
      updateTransaction(client, { id: "txn-1", allocations: [] }),
    ).rejects.toMatchObject({ code: "allocations_required" });
  });

  it("allows clearing allocations when simultaneously un-approving", async () => {
    const client = makeMockClient(txnRow({ approved_at: APPROVED_AT }));
    await expect(
      updateTransaction(client, { id: "txn-1", approvedAt: null, allocations: [] }),
    ).resolves.toBeDefined();
  });

  it("throws not_found when transaction does not exist", async () => {
    const client = makeMockClient(null);
    await expect(
      updateTransaction(client, { id: "nonexistent" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("moves an approved categorized txn onto a new account (account_id in patch)", async () => {
    // Records the payload passed to .update() so we can assert account_id lands.
    const updateArgs: Record<string, unknown>[] = [];
    const singleFn = vi
      .fn()
      .mockResolvedValue({ data: txnRow({ approved_at: APPROVED_AT }), error: null });
    const proxy: Record<string, unknown> = new Proxy(
      {} as Record<string, unknown>,
      {
        get(_, prop) {
          if (prop === "single") return singleFn;
          if (prop === "update")
            return (arg: Record<string, unknown>) => {
              updateArgs.push(arg);
              return proxy;
            };
          return () => proxy;
        },
      },
    );
    const client = {
      from: vi.fn(() => proxy),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    } as unknown as SupabaseClient;

    await expect(
      updateTransaction(client, {
        id: "txn-1",
        accountId: "acc-2",
        amountCents: -5000,
        allocations: ALLOCS_OK,
      }),
    ).resolves.toBeDefined();

    expect(updateArgs.some((a) => a.account_id === "acc-2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteTransactionWithCounterpart — transfer-aware delete
// ---------------------------------------------------------------------------

// Records every id passed to a `.delete().eq("id", …)` chain. `single()`
// returns the fetched row; un-terminated select chains resolve to
// `counterpartRows` (the transfer counterpart lookup).
function makeDeleteMock(
  fetchRow: TransactionRow | null,
  counterpartRows: { id: string }[] = [],
) {
  const deletedIds: string[] = [];

  const client = {
    from: vi.fn(() => {
      let mode: "select" | "delete" = "select";
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        delete: () => {
          mode = "delete";
          return builder;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        neq: () => builder,
        single: () => Promise.resolve({ data: fetchRow, error: null }),
        then: (resolve: (v: unknown) => void) => {
          if (mode === "delete") {
            deletedIds.push(filters.id as string);
            resolve({ data: null, error: null });
          } else {
            resolve({ data: counterpartRows, error: null });
          }
        },
      };
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { client, deletedIds };
}

describe("deleteTransactionWithCounterpart", () => {
  it("deletes a plain transaction by id", async () => {
    const { client, deletedIds } = makeDeleteMock(txnRow());
    await deleteTransactionWithCounterpart(client, "txn-1");
    expect(deletedIds).toEqual(["txn-1"]);
  });

  it("deletes both legs of a transfer", async () => {
    const { client, deletedIds } = makeDeleteMock(
      txnRow({ transfer_account_id: "acc-2", amount_cents: -5000 }),
      [{ id: "txn-2" }],
    );
    await deleteTransactionWithCounterpart(client, "txn-1");
    expect(deletedIds).toContain("txn-2");
    expect(deletedIds).toContain("txn-1");
  });

  it("deletes only the leg present when no counterpart is found", async () => {
    const { client, deletedIds } = makeDeleteMock(
      txnRow({ transfer_account_id: "acc-2" }),
      [],
    );
    await deleteTransactionWithCounterpart(client, "txn-1");
    expect(deletedIds).toEqual(["txn-1"]);
  });

  it("throws not_found when the transaction does not exist", async () => {
    const { client } = makeDeleteMock(null);
    await expect(
      deleteTransactionWithCounterpart(client, "nope"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

// ---------------------------------------------------------------------------
// reconcileWithRegisterBalance / reconcileWithAdjustment
// ---------------------------------------------------------------------------

type Line = { amount_cents: number; cleared_at: string | null };

// Stateful Supabase fake: cleared inserts land in the register and account
// balance updates stick, so a follow-up reconcile sees a consistent picture —
// enough to exercise the full reconcile-with-adjustment path end to end.
function makeReconcileMock(initial: {
  transactions: Line[];
  balanceCents: number;
  readyToAssignId?: string | null;
}) {
  const state = {
    transactions: [...initial.transactions],
    balanceCents: initial.balanceCents,
  };
  const readyToAssignId =
    initial.readyToAssignId === undefined ? "rta-1" : initial.readyToAssignId;
  const inserted: Record<string, unknown>[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

  function makeBuilder(table: string) {
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Record<string, unknown> | null = null;

    function resolveSingle() {
      if (table === "categories") {
        return {
          data: readyToAssignId ? { id: readyToAssignId } : null,
          error: null,
        };
      }
      if (table === "account_balances") {
        // Mirror the account_balances view: cleared/uncleared/working sums.
        const cleared = state.transactions
          .filter((t) => t.cleared_at !== null)
          .reduce((s, t) => s + t.amount_cents, 0);
        const uncleared = state.transactions
          .filter((t) => t.cleared_at === null)
          .reduce((s, t) => s + t.amount_cents, 0);
        return {
          data: {
            account_id: "acc-1",
            cleared_cents: cleared,
            uncleared_cents: uncleared,
            working_cents: cleared + uncleared,
          },
          error: null,
        };
      }
      if (table === "accounts") {
        if (op === "update") {
          state.balanceCents = payload!.balance_cents as number;
        }
        return {
          data: {
            id: "acc-1",
            name: "Acct",
            type: "checking",
            balance_cents: state.balanceCents,
            payment_category_id: null,
            is_linked: false,
            is_active: true,
            created_at: "2026-01-01T00:00:00Z",
          },
          error: null,
        };
      }
      if (table === "transactions" && op === "insert") {
        const row: TransactionRow = {
          id: `txn-${inserted.length + 1}`,
          account_id: (payload!.account_id as string) ?? "acc-1",
          amount_cents: payload!.amount_cents as number,
          txn_date: payload!.txn_date as string,
          payee: (payload!.payee as string) ?? "",
          memo: (payload!.memo as string | null) ?? null,
          transfer_account_id: null,
          imported_id: null,
          approved_at: (payload!.approved_at as string | null) ?? null,
          cleared_at: (payload!.cleared_at as string | null) ?? null,
          reconciled_at: null,
          created_at: "2026-01-01T00:00:00Z",
        };
        inserted.push(payload!);
        state.transactions.push({
          amount_cents: row.amount_cents,
          cleared_at: row.cleared_at,
        });
        return { data: row, error: null };
      }
      // transactions UPDATE … RETURNING (deferred-approval step)
      return {
        data: { ...txnRow(), approved_at: (payload?.approved_at as string) ?? null },
        error: null,
      };
    }

    function resolveList() {
      if (table === "transactions" && op === "select") {
        return {
          data: state.transactions.map((t) => ({
            amount_cents: t.amount_cents,
            cleared_at: t.cleared_at,
          })),
          error: null,
        };
      }
      return { data: null, error: null };
    }

    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (p: Record<string, unknown>) => {
        op = "insert";
        payload = p;
        return builder;
      },
      update: (p: Record<string, unknown>) => {
        op = "update";
        payload = p;
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      eq: () => builder,
      neq: () => builder,
      not: () => builder,
      is: () => builder,
      lte: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve(resolveSingle()),
      single: () => Promise.resolve(resolveSingle()),
      then: (resolve: (v: unknown) => void) => resolve(resolveList()),
    };
    return builder;
  }

  const client = {
    from: vi.fn((table: string) => makeBuilder(table)),
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ error: null });
    }),
  } as unknown as SupabaseClient;

  return { client, state, inserted, rpcCalls };
}

describe("reconcileWithRegisterBalance", () => {
  it("snaps balance_cents to the register cleared sum and reconciles", async () => {
    const { client, state, inserted } = makeReconcileMock({
      transactions: [
        { amount_cents: 10_000, cleared_at: "2026-05-01T00:00:00Z" },
        { amount_cents: -3000, cleared_at: "2026-05-01T00:00:00Z" },
      ],
      balanceCents: 99_999, // stale, as it would be on an unlinked account
    });

    const result = await reconcileWithRegisterBalance(client, "acc-1");

    expect(result.reconciledAt).toBeDefined();
    expect(state.balanceCents).toBe(7000);
    expect(inserted).toHaveLength(0); // no adjustment on the "looks right" path
  });
});

describe("reconcileWithAdjustment", () => {
  it("rejects a non-integer cents amount before touching the DB", async () => {
    const { client } = makeReconcileMock({ transactions: [], balanceCents: 0 });
    await expect(
      reconcileWithAdjustment(client, "acc-1", 1234.5),
    ).rejects.toMatchObject({ code: "invalid_cents" });
  });

  it("writes a cleared adjustment for the difference, assigned to Ready to Assign", async () => {
    const { client, state, inserted, rpcCalls } = makeReconcileMock({
      transactions: [{ amount_cents: 10_000, cleared_at: "2026-05-01T00:00:00Z" }],
      balanceCents: 10_000,
    });

    const result = await reconcileWithAdjustment(client, "acc-1", 15_000);

    expect(result.reconciledAt).toBeDefined();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      amount_cents: 5000,
      payee: RECONCILIATION_ADJUSTMENT_PAYEE,
    });
    expect(inserted[0].cleared_at).not.toBeNull();
    expect(state.balanceCents).toBe(15_000);

    const allocRpc = rpcCalls.find((c) => c.fn === "ledger_replace_allocations");
    expect(allocRpc?.args.p_allocations).toEqual([
      { category_id: "rta-1", amount_cents: 5000 },
    ]);
  });

  it("allows a negative adjustment for credit-card debt", async () => {
    const { client, state, inserted } = makeReconcileMock({
      transactions: [{ amount_cents: -10_000, cleared_at: "2026-05-01T00:00:00Z" }],
      balanceCents: -10_000,
    });

    const result = await reconcileWithAdjustment(client, "acc-1", -15_000);

    expect(result.reconciledAt).toBeDefined();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ amount_cents: -5000 });
    expect(state.balanceCents).toBe(-15_000);
  });

  it("skips the adjustment when the actual balance already matches", async () => {
    const { client, state, inserted } = makeReconcileMock({
      transactions: [{ amount_cents: 10_000, cleared_at: "2026-05-01T00:00:00Z" }],
      balanceCents: 10_000,
    });

    const result = await reconcileWithAdjustment(client, "acc-1", 10_000);

    expect(result.reconciledAt).toBeDefined();
    expect(inserted).toHaveLength(0);
    expect(state.balanceCents).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// createAccount — plan ownership
// ---------------------------------------------------------------------------

describe("createAccount", () => {
  // Captures the payload passed to accounts.insert(); single() echoes it back as
  // the created row. openingBalanceCents defaults to 0, so no further DB calls fire.
  function makeAccountMock() {
    const insert = vi.fn();
    const client = {
      from: vi.fn(() => ({
        insert: (payload: Record<string, unknown>) => {
          insert(payload);
          return {
            select: () => ({
              single: vi.fn().mockResolvedValue({
                data: { id: "acc-9", is_active: true, created_at: "x", ...payload },
                error: null,
              }),
            }),
          };
        },
      })),
    } as unknown as SupabaseClient;
    return { client, insert };
  }

  it("stamps plan_id on the inserted account row", async () => {
    const { client, insert } = makeAccountMock();

    await createAccount(client, {
      planId: "plan-1",
      name: "Checking",
      type: "checking",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ plan_id: "plan-1", name: "Checking", type: "checking" }),
    );
  });
});

describe("createTransfer", () => {
  function makeTransferMock() {
    const rpc = vi.fn().mockResolvedValue({
      data: { outflow_transaction_id: "out-1", inflow_transaction_id: "in-1" },
      error: null,
    });
    const client = { from: vi.fn(), rpc } as unknown as SupabaseClient;
    return { client, rpc };
  }

  it("passes importedId through as p_imported_id for re-run idempotency", async () => {
    const { client, rpc } = makeTransferMock();

    await createTransfer(client, {
      fromAccountId: "acc-1",
      toAccountId: "acc-2",
      amountCents: 5000,
      txnDate: "2026-01-15",
      importedId: "csv:abc123",
    });

    expect(rpc).toHaveBeenCalledWith(
      "ledger_create_transfer",
      expect.objectContaining({ p_imported_id: "csv:abc123" }),
    );
  });

  it("defaults p_imported_id to null when not provided", async () => {
    const { client, rpc } = makeTransferMock();

    await createTransfer(client, {
      fromAccountId: "acc-1",
      toAccountId: "acc-2",
      amountCents: 5000,
      txnDate: "2026-01-15",
    });

    expect(rpc).toHaveBeenCalledWith(
      "ledger_create_transfer",
      expect.objectContaining({ p_imported_id: null }),
    );
  });
});

describe("bulkUpsertTransactions", () => {
  function makeBulkMock(resultRows: { idx: number; transaction_id: string; created: boolean }[]) {
    const rpc = vi.fn().mockResolvedValue({ data: resultRows, error: null });
    const client = { from: vi.fn(), rpc } as unknown as SupabaseClient;
    return { client, rpc };
  }

  it("returns [] without calling the RPC for an empty input", async () => {
    const { client, rpc } = makeBulkMock([]);
    await expect(bulkUpsertTransactions(client, [])).resolves.toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends one row per input, snake_cased, and maps results back by index", async () => {
    const { client, rpc } = makeBulkMock([
      { idx: 0, transaction_id: "txn-a", created: true },
      { idx: 1, transaction_id: "txn-b", created: false },
    ]);

    const result = await bulkUpsertTransactions(client, [
      {
        accountId: "acc-1",
        amountCents: -5000,
        txnDate: "2026-01-15",
        payee: "Coffee",
        importedId: "csv:aaa",
        approvedAt: "2026-01-15T00:00:00Z",
        clearedAt: "2026-01-15T00:00:00Z",
        allocations: [{ categoryId: "cat-1", amountCents: -5000 }],
      },
      {
        accountId: "acc-2",
        amountCents: 1000,
        txnDate: "2026-01-16",
        importedId: "csv:bbb",
      },
    ]);

    expect(rpc).toHaveBeenCalledWith("ledger_bulk_upsert_transactions", {
      p_rows: [
        expect.objectContaining({
          idx: 0,
          account_id: "acc-1",
          amount_cents: -5000,
          imported_id: "csv:aaa",
          allocations: [{ category_id: "cat-1", amount_cents: -5000 }],
        }),
        expect.objectContaining({
          idx: 1,
          account_id: "acc-2",
          amount_cents: 1000,
          imported_id: "csv:bbb",
          allocations: [],
        }),
      ],
    });
    expect(result).toEqual([
      { index: 0, transactionId: "txn-a", created: true },
      { index: 1, transactionId: "txn-b", created: false },
    ]);
  });

  it("rejects before calling the RPC when an approved row has mismatched allocations", async () => {
    const { client, rpc } = makeBulkMock([]);
    await expect(
      bulkUpsertTransactions(client, [
        {
          accountId: "acc-1",
          amountCents: -5000,
          txnDate: "2026-01-15",
          importedId: "csv:aaa",
          approvedAt: "2026-01-15T00:00:00Z",
          allocations: [{ categoryId: "cat-1", amountCents: -4000 }],
        },
      ]),
    ).rejects.toMatchObject({ code: "split_sum_mismatch" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's row-identifying error on db failure", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "ledger_bulk_upsert_transactions: row 3 (imported_id csv:xyz) allocations do not sum to amount_cents" },
    });
    const client = { from: vi.fn(), rpc } as unknown as SupabaseClient;

    await expect(
      bulkUpsertTransactions(client, [
        { accountId: "acc-1", amountCents: -100, txnDate: "2026-01-15", importedId: "csv:xyz" },
      ]),
    ).rejects.toMatchObject({ message: expect.stringContaining("row 3 (imported_id csv:xyz)") });
  });
});

describe("bulkUpsertCategoryBudgets", () => {
  it("resolves without calling the RPC for an empty input", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn(), rpc } as unknown as SupabaseClient;
    await bulkUpsertCategoryBudgets(client, []);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends one snake_cased row per input", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn(), rpc } as unknown as SupabaseClient;

    await bulkUpsertCategoryBudgets(client, [
      { categoryId: "cat-1", month: "2026-01-01", assignedCents: 5000 },
      { categoryId: "cat-2", month: "2026-02-01", assignedCents: -1000 },
    ]);

    expect(rpc).toHaveBeenCalledWith("ledger_bulk_upsert_category_budgets", {
      p_rows: [
        { month: "2026-01-01", category_id: "cat-1", assigned_cents: 5000 },
        { month: "2026-02-01", category_id: "cat-2", assigned_cents: -1000 },
      ],
    });
  });
});
