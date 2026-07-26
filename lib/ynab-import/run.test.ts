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
 * chains sufficient for runImport's account/category resolution + ledger calls.
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

  const transactions = new Map<string, { id: string; account_id: string; imported_id: string | null; amount_cents: number; approved_at: string | null }>();
  const fullRows = new Map<string, Record<string, unknown>>();

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
    if (table === "monthly_budgets") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          monthlyBudgets.push({
            id: nextId("mb"),
            month: payload.month as string,
            category_id: payload.category_id as string,
            assigned_cents: payload.assigned_cents as number,
          });
          return Promise.resolve({ error: null });
        },
      };
    }
    if (table === "transactions") {
      return {
        select: () => ({
          eq: (_c1: string, accountId: string) => ({
            eq: (_c2: string, importedId: string) => ({
              maybeSingle: async () => {
                const found = [...transactions.values()].find(
                  (t) => t.account_id === accountId && t.imported_id === importedId,
                );
                return { data: found ? { id: found.id, amount_cents: found.amount_cents } : null, error: null };
              },
            }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          const id = nextId("txn");
          const row = {
            id,
            account_id: payload.account_id as string,
            imported_id: (payload.imported_id as string) ?? null,
            amount_cents: payload.amount_cents as number,
            approved_at: (payload.approved_at as string) ?? null,
          };
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
    rpc: vi.fn((fn: string) => {
      if (fn === "ledger_replace_allocations") return Promise.resolve({ error: null });
      throw new Error(`unexpected rpc in test double: ${fn}`);
    }),
  } as unknown as SupabaseClient;

  return { client, accounts, categoryGroups, categories, monthlyBudgets };
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
