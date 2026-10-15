import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  transactionsSync: vi.fn(),
  upsertTransaction: vi.fn(),
}));

vi.mock("./client", () => ({
  createPlaidClient: () => ({ transactionsSync: mocks.transactionsSync }),
}));

vi.mock("@/lib/ledger", () => ({
  RECONCILIATION_ADJUSTMENT_PAYEE: "Reconciliation Adjustment",
  applyCategorySuggestions: vi.fn().mockResolvedValue(undefined),
  upsertTransaction: mocks.upsertTransaction,
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  syncBankClearedBalance: vi.fn().mockResolvedValue(undefined),
  createAccount: vi.fn(),
}));

import { syncItem } from "./sync";

const ITEM = {
  id: "item-row-1",
  plan_id: "plan-1",
  plaid_item_id: "plaid-item-1",
  access_token: "access-token",
  transactions_cursor: "cursor-old",
  ignored_account_ids: null,
};

function plaidTxn(id: string, amount: number) {
  return {
    transaction_id: id,
    account_id: "plaid-acct-1",
    amount,
    date: "2026-10-07",
    authorized_date: null,
    name: "Target",
    merchant_name: "Target",
    pending: false,
    pending_transaction_id: null,
  };
}

// Any Supabase chain resolves (when awaited) to the table's canned rows; every
// .update() is recorded so tests can assert whether the cursor was saved.
function makeClient() {
  const updates: { table: string; arg: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      const data =
        table === "accounts"
          ? [{ id: "acct-1", plaid_account_id: "plaid-acct-1" }]
          : [];
      const builder: Record<string, unknown> = new Proxy(
        {} as Record<string, unknown>,
        {
          get(_, prop) {
            if (prop === "then") {
              return (resolve: (v: unknown) => void) => resolve({ data, error: null });
            }
            if (prop === "update") {
              return (arg: Record<string, unknown>) => {
                updates.push({ table, arg });
                return builder;
              };
            }
            return () => builder;
          },
        },
      );
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, updates };
}

function syncPage(added: ReturnType<typeof plaidTxn>[]) {
  mocks.transactionsSync.mockResolvedValue({
    data: {
      added,
      modified: [],
      removed: [],
      accounts: [],
      next_cursor: "cursor-new",
      has_more: false,
    },
  });
}

const cursorSaves = (updates: { table: string; arg: Record<string, unknown> }[]) =>
  updates.filter((u) => u.table === "plaid_items" && "transactions_cursor" in u.arg);

describe("syncItem — cursor handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.upsertTransaction.mockResolvedValue({ transaction: { id: "txn-x" } });
  });

  it("saves the new cursor when every transaction is written", async () => {
    syncPage([plaidTxn("t1", 12.34), plaidTxn("t2", 5.0)]);
    const { client, updates } = makeClient();

    const result = await syncItem(client, ITEM);

    expect(result.addedCount).toBe(2);
    const saves = cursorSaves(updates);
    expect(saves).toHaveLength(1);
    expect(saves[0].arg.transactions_cursor).toBe("cursor-new");
  });

  it("writes the rest of the batch but holds the cursor back and throws when a row fails", async () => {
    syncPage([plaidTxn("t1", 12.34), plaidTxn("bad", 51.26), plaidTxn("t3", 5.0)]);
    mocks.upsertTransaction.mockImplementation(async (_c: unknown, input: { importedId: string }) => {
      if (input.importedId === "bad") throw new Error("split_sum_mismatch");
      return { transaction: { id: `txn-${input.importedId}` } };
    });
    const { client, updates } = makeClient();

    await expect(syncItem(client, ITEM)).rejects.toThrow(
      /1 transaction\(s\) failed to sync.*cursor not advanced.*split_sum_mismatch/,
    );

    // Rows on both sides of the failure were still attempted.
    expect(mocks.upsertTransaction).toHaveBeenCalledTimes(3);
    // The cursor must not move past the failed row, or Plaid never resends it.
    expect(cursorSaves(updates)).toHaveLength(0);
  });
});
