import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { runImport } from "./run";
import type { RegisterParseResult, PlanParseResult } from "./types";

function emptyRegister(overrides: Partial<RegisterParseResult> = {}): RegisterParseResult {
  return {
    transactions: [],
    openingBalances: [],
    transfers: [],
    offBudgetAccounts: [],
    warnings: [],
    ...overrides,
  };
}

function emptyPlan(overrides: Partial<PlanParseResult> = {}): PlanParseResult {
  return { assignments: [], warnings: [], ...overrides };
}

/**
 * Minimal in-memory Supabase-like double: table-backed insert/select/update/single
 * chains for account/category resolution and the still-single-row opening-balance
 * path, plus RPC handlers for the bulk transaction/assignment writes runImport
 * now uses (ledger_bulk_upsert_transactions, ledger_bulk_upsert_category_budgets)
 * and the still-used ledger_replace_allocations (single-row opening balances).
 */
function makeClient() {
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  const accounts = new Map<string, { id: string; name: string; type: string; payment_category_id: string | null; is_active: boolean; created_at: string }>();
  const categoryGroups = new Map<string, { id: string; name: string }>();
  const categories = new Map<string, { id: string; name: string; group_id: string }>();
  const monthlyBudgets: { id: string; month: string; category_id: string; assigned_cents: number }[] = [];
  const readyToAssignCategoryId = "cat-rta";
  categories.set(readyToAssignCategoryId, { id: readyToAssignCategoryId, name: "Ready to Assign", group_id: "grp-system" });

  type TxnRow = {
    id: string;
    account_id: string;
    imported_id: string | null;
    amount_cents: number;
    approved_at: string | null;
    txn_date?: unknown;
    payee?: unknown;
    memo?: unknown;
    transfer_account_id?: unknown;
    cleared_at?: unknown;
    reconciled_at?: unknown;
    created_at?: unknown;
  };
  const transactions = new Map<string, TxnRow>();
  const fullRows = new Map<string, Record<string, unknown>>();

  function findTxnByAccountImportedId(accountId: string, importedId: string | null) {
    return [...transactions.values()].find((t) => t.account_id === accountId && t.imported_id === importedId);
  }

  function tableHandlers(table: string) {
    if (table === "accounts") {
      return {
        insert: (payload: Record<string, unknown>) => {
          const id = nextId("acc");
          const row = { id, name: payload.name as string, type: payload.type as string, payment_category_id: (payload.payment_category_id as string) ?? null, is_active: true, created_at: "2026-01-01T00:00:00Z" };
          accounts.set(id, row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        },
        select: () => ({
          eq: (_col: string, id: string) => ({
            single: async () => ({ data: accounts.get(id) ?? null, error: accounts.get(id) ? null : { message: "not found" } }),
          }),
        }),
      };
    }
    if (table === "category_groups") {
      return {
        select: () => ({
          eq: (_col: string, name: string) => ({
            maybeSingle: async () => {
              const found = [...categoryGroups.values()].find((g) => g.name === name);
              return { data: found ?? null, error: null };
            },
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          const id = nextId("grp");
          const row = { id, name: payload.name as string };
          categoryGroups.set(id, row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        },
      };
    }
    if (table === "categories") {
      return {
        select: () => ({
          eq: (col: string, value: string) => {
            if (col === "role" && value === "ready_to_assign") {
              return { maybeSingle: async () => ({ data: { id: readyToAssignCategoryId }, error: null }) };
            }
            return {
              maybeSingle: async () => ({ data: null, error: null }),
              single: async () => ({
                data: categories.get(value) ?? null,
                error: categories.get(value) ? null : { message: "not found" },
              }),
            };
          },
        }),
        insert: (payload: Record<string, unknown>) => {
          const id = nextId("cat");
          const row = { id, name: payload.name as string, group_id: payload.group_id as string };
          categories.set(id, row);
          return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
        },
      };
    }
    if (table === "transactions") {
      return {
        select: () => ({
          eq: (_c1: string, accountId: string) => ({
            eq: (_c2: string, importedId: string) => ({
              maybeSingle: async () => {
                const found = findTxnByAccountImportedId(accountId, importedId);
                return { data: found ? { id: found.id, amount_cents: found.amount_cents } : null, error: null };
              },
            }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          const id = nextId("txn");
          const row: TxnRow = {
            id,
            account_id: payload.account_id as string,
            imported_id: (payload.imported_id as string) ?? null,
            amount_cents: payload.amount_cents as number,
            approved_at: (payload.approved_at as string) ?? null,
          };
          transactions.set(id, row);
          const full = { ...row, txn_date: payload.txn_date, payee: payload.payee, memo: payload.memo, transfer_account_id: payload.transfer_account_id ?? null, cleared_at: payload.cleared_at ?? null, reconciled_at: null, created_at: "2026-01-01T00:00:00Z" };
          fullRows.set(id, full);
          return { select: () => ({ single: async () => ({ data: full, error: null }) }) };
        },
        update: (patch: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => ({
            select: () => ({
              single: async () => {
                const existing = fullRows.get(id);
                if (!existing) return { data: null, error: { message: "not found" } };
                const updated = { ...existing, ...patch };
                fullRows.set(id, updated);
                const t = transactions.get(id);
                if (t) transactions.set(id, { ...t, amount_cents: (patch.amount_cents as number) ?? t.amount_cents, approved_at: patch.approved_at !== undefined ? (patch.approved_at as string | null) : t.approved_at });
                return { data: updated, error: null };
              },
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table in test double: ${table}`);
  }

  const client = {
    from: (table: string) => tableHandlers(table),
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "ledger_replace_allocations") return { data: null, error: null };

      if (fn === "ledger_bulk_upsert_transactions") {
        const rows = (args?.p_rows ?? []) as {
          idx: number;
          account_id: string;
          amount_cents: number;
          txn_date: string;
          payee: string;
          memo: string | null;
          imported_id: string;
          cleared_at: string | null;
          approved_at: string | null;
        }[];

        const result = rows.map((row) => {
          const existing = findTxnByAccountImportedId(row.account_id, row.imported_id);
          const id = existing?.id ?? nextId("txn");
          transactions.set(id, {
            id,
            account_id: row.account_id,
            imported_id: row.imported_id,
            amount_cents: row.amount_cents,
            approved_at: row.approved_at,
            txn_date: row.txn_date,
            payee: row.payee,
            memo: row.memo,
            cleared_at: row.cleared_at,
          });
          return { idx: row.idx, transaction_id: id, created: !existing };
        });

        return { data: result, error: null };
      }

      if (fn === "ledger_bulk_upsert_category_budgets") {
        const rows = (args?.p_rows ?? []) as { month: string; category_id: string; assigned_cents: number }[];
        for (const row of rows) {
          monthlyBudgets.push({ id: nextId("mb"), month: row.month, category_id: row.category_id, assigned_cents: row.assigned_cents });
        }
        return { data: null, error: null };
      }

      throw new Error(`unexpected rpc in test double: ${fn}`);
    }),
  } as unknown as SupabaseClient;

  return { client, accounts, categoryGroups, categories, monthlyBudgets, transactions };
}

describe("runImport", () => {
  it("creates a new checking account, a new category, and imports one categorized transaction as approved", async () => {
    const { client, accounts, categories } = makeClient();

    const register = emptyRegister({
      transactions: [
        {
          account: "Checking",
          date: "2026-01-15",
          payee: "Coffee Shop",
          memo: "",
          amountCents: -450,
          cleared: true,
          allocations: [{ categoryGroup: "General", category: "Dining", amountCents: -450 }],
          rowIndex: 0,
        },
      ],
    });

    const summary = await runImport(client, {
      register,
      plan: emptyPlan(),
      planId: "plan-1",
      accountResolutions: [{ csvName: "Checking", action: "create", type: "checking" }],
      categoryResolutions: [{ categoryGroup: "General", category: "Dining", action: "create" }],
    });

    expect(summary.accountsCreated).toBe(1);
    expect(summary.categoriesCreated).toBe(1);
    expect(summary.transactionsCreated).toBe(1);
    expect(summary.errors).toEqual([]);
    expect([...accounts.values()]).toHaveLength(1);
    expect([...categories.values()]).toHaveLength(2); // Dining + system RTA seed
  });

  it("bulk-writes multiple transactions in one batch and reports created vs. updated on re-run", async () => {
    const { client, accounts } = makeClient();

    const register = emptyRegister({
      transactions: [
        {
          account: "Checking",
          date: "2026-01-15",
          payee: "Coffee Shop",
          memo: "",
          amountCents: -450,
          cleared: true,
          allocations: [{ categoryGroup: "General", category: "Dining", amountCents: -450 }],
          rowIndex: 0,
        },
        {
          account: "Checking",
          date: "2026-01-16",
          payee: "Grocery Store",
          memo: "",
          amountCents: -2000,
          cleared: true,
          allocations: [{ categoryGroup: "General", category: "Dining", amountCents: -2000 }],
          rowIndex: 1,
        },
      ],
    });
    const importArgs = {
      register,
      plan: emptyPlan(),
      planId: "plan-1",
      accountResolutions: [{ csvName: "Checking", action: "create" as const, type: "checking" as const }],
      categoryResolutions: [{ categoryGroup: "General", category: "Dining", action: "create" as const }],
    };

    const first = await runImport(client, importArgs);
    expect(first.transactionsCreated).toBe(2);
    expect(first.transactionsUpdated).toBe(0);
    expect(first.errors).toEqual([]);

    const createdAccountId = [...accounts.values()][0].id;

    // Re-running against the same account with the same (deterministic) imported_id
    // hashes should update in place, not duplicate.
    const second = await runImport(client, {
      ...importArgs,
      accountResolutions: [{ csvName: "Checking", action: "existing", accountId: createdAccountId }],
    });
    expect(second.transactionsCreated).toBe(0);
    expect(second.transactionsUpdated).toBe(2);
  });

  it("reports a batch-level error naming the failed rows when the bulk RPC rejects, without crediting any as written", async () => {
    const { client } = makeClient();
    const rpcMock = client.rpc as unknown as ReturnType<typeof vi.fn>;
    const original = rpcMock.getMockImplementation()!;
    rpcMock.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "ledger_bulk_upsert_transactions") {
        return { data: null, error: { message: "row 0 (imported_id csv:aaa) allocations do not sum to amount_cents" } };
      }
      return original(fn, args);
    });

    const register = emptyRegister({
      transactions: [
        {
          account: "Checking",
          date: "2026-01-15",
          payee: "Coffee Shop",
          memo: "",
          amountCents: -450,
          cleared: true,
          allocations: [{ categoryGroup: "General", category: "Dining", amountCents: -450 }],
          rowIndex: 0,
        },
      ],
    });

    const summary = await runImport(client, {
      register,
      plan: emptyPlan(),
      planId: "plan-1",
      accountResolutions: [{ csvName: "Checking", action: "create", type: "checking" }],
      categoryResolutions: [{ categoryGroup: "General", category: "Dining", action: "create" }],
    });

    expect(summary.transactionsCreated).toBe(0);
    expect(summary.transactionsUpdated).toBe(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toMatch(/Batch of 1 transactions failed, none were written/);
    expect(summary.errors[0]).toMatch(/Checking\/2026-01-15\/"Coffee Shop"/);
    expect(summary.errors[0]).toMatch(/row 0 \(imported_id csv:aaa\)/);
  });

  it("skips a zero-amount on-budget opening balance without erroring", async () => {
    const { client } = makeClient();

    const register = emptyRegister({
      openingBalances: [{ account: "Chase", date: "2026-01-01", amountCents: 0, onBudget: true }],
    });

    const summary = await runImport(client, {
      register,
      plan: emptyPlan(),
      planId: "plan-1",
      accountResolutions: [{ csvName: "Chase", action: "create", type: "credit" }],
      categoryResolutions: [],
    });

    expect(summary.openingBalancesCreated).toBe(0);
    expect(summary.errors).toEqual([]);
  });

  it("skips a tracking account's transactions and opening balance entirely", async () => {
    const { client } = makeClient();

    const register = emptyRegister({
      openingBalances: [{ account: "Brokerage", date: "2026-01-01", amountCents: 100000, onBudget: false }],
    });

    const summary = await runImport(client, {
      register,
      plan: emptyPlan(),
      planId: "plan-1",
      accountResolutions: [{ csvName: "Brokerage", action: "skip" }],
      categoryResolutions: [],
    });

    expect(summary.skippedAccounts).toEqual(["Brokerage"]);
    expect(summary.openingBalancesCreated).toBe(0);
    expect(summary.accountsCreated).toBe(0);
  });

  it("resolves Credit Card Payments assignment rows to the credit account's payment category", async () => {
    const { client } = makeClient();

    const plan = emptyPlan({
      assignments: [
        {
          month: "2026-02-01",
          categoryGroup: "Credit Card Payments",
          category: "Card",
          isCreditCardPayment: true,
          assignedCents: 2581,
        },
      ],
    });

    const summary = await runImport(client, {
      register: emptyRegister(),
      plan,
      planId: "plan-1",
      accountResolutions: [{ csvName: "Card", action: "create", type: "credit" }],
      categoryResolutions: [],
    });

    expect(summary.assignmentsWritten).toBe(1);
    expect(summary.errors).toEqual([]);
  });

  it("bulk-writes multiple assignments in one batch", async () => {
    const { client, monthlyBudgets } = makeClient();

    const plan = emptyPlan({
      assignments: [
        { month: "2026-01-01", categoryGroup: "General", category: "Dining", isCreditCardPayment: false, assignedCents: 5000 },
        { month: "2026-02-01", categoryGroup: "General", category: "Dining", isCreditCardPayment: false, assignedCents: 6000 },
      ],
    });

    const summary = await runImport(client, {
      register: emptyRegister(),
      plan,
      planId: "plan-1",
      accountResolutions: [],
      categoryResolutions: [{ categoryGroup: "General", category: "Dining", action: "create" }],
    });

    expect(summary.assignmentsWritten).toBe(2);
    expect(summary.errors).toEqual([]);
    expect(monthlyBudgets).toHaveLength(2);
  });

  it("records an error and skips the transaction when a category can't be resolved", async () => {
    const { client } = makeClient();

    const register = emptyRegister({
      transactions: [
        {
          account: "Checking",
          date: "2026-01-15",
          payee: "Mystery",
          memo: "",
          amountCents: -450,
          cleared: true,
          allocations: [{ categoryGroup: "Unmapped", category: "Nope", amountCents: -450 }],
          rowIndex: 0,
        },
      ],
    });

    const summary = await runImport(client, {
      register,
      plan: emptyPlan(),
      planId: "plan-1",
      accountResolutions: [{ csvName: "Checking", action: "create", type: "checking" }],
      categoryResolutions: [],
    });

    expect(summary.transactionsCreated).toBe(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toMatch(/could not resolve category/);
  });
});
