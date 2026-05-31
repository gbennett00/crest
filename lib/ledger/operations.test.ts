import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createTransaction, updateTransaction, upsertTransaction } from "./operations";
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
});
