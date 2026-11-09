import { describe, expect, it } from "vitest";
import type { HomeData, PendingTransaction } from "@/lib/budget";
import type { AllTransactionsResponse, AllTransactionsRow } from "@/app/api/transactions/route";
import type { AccountRegisterResponse } from "@/app/api/accounts/[id]/register/route";
import type { TransactionDetailResponse } from "./transaction-detail";
import { patchLedgerData, patchLedgerDataAll, type TxnPatch } from "./txn-patch";

const HOME_KEY = ["ledger", "home-view"];
const ALL_KEY = ["ledger", "all-transactions", {}];
const registerKey = (accountId: string) => ["ledger", "account-register", accountId, undefined, undefined];
const detailKey = (id: string) => ["ledger", "transaction-detail", id];

function pending(overrides: Partial<PendingTransaction> = {}): PendingTransaction {
  return {
    id: "t1",
    payee: "Coffee Co",
    amountCents: -450,
    txnDate: "2026-11-01",
    accountName: "Checking",
    categoryLabel: "Dining",
    suggested: true,
    categoryId: "dining",
    allocationCount: 1,
    suggestedCategoryIds: ["dining"],
    ...overrides,
  };
}

function home(rows: PendingTransaction[]): HomeData {
  return { pending: rows } as unknown as HomeData;
}

function row(overrides: Partial<AllTransactionsRow> = {}): AllTransactionsRow {
  return {
    id: "t1",
    payee: "Coffee Co",
    amountCents: -450,
    txnDate: "2026-11-01",
    approved: false,
    cleared: false,
    reconciled: false,
    memo: null,
    categoryLabel: "Dining",
    suggested: true,
    needsCategory: false,
    accountId: "checking",
    accountName: "Checking",
    ...overrides,
  };
}

function allTxns(rows: AllTransactionsRow[]): AllTransactionsResponse {
  return { txns: rows, hasMore: false, accountOptions: [], categoryOptions: [] };
}

function register(rows: AllTransactionsRow[]): AccountRegisterResponse {
  return { txns: rows } as unknown as AccountRegisterResponse;
}

function detail(overrides: Partial<NonNullable<TransactionDetailResponse["txn"]>> = {}) {
  return {
    txn: {
      id: "t1",
      payee: "Coffee Co",
      txnDate: "2026-11-01",
      accountId: "checking",
      amountCents: -450,
      memo: null,
      clearedAt: null,
      reconciledAt: null,
      transferAccountId: null,
      isApproved: false,
      categorySource: "history",
      categoryId: "dining",
      allocations: [{ categoryId: "dining", amountCents: -450 }],
      ...overrides,
    },
    accounts: [],
    accountNameById: {},
    categories: [],
  } satisfies TransactionDetailResponse;
}

const pendingOf = (data: unknown) => (data as HomeData).pending;
const rowsOf = (data: unknown) => (data as AllTransactionsResponse).txns;
const txnOf = (data: unknown) => (data as TransactionDetailResponse).txn;

describe("patchLedgerData: unchanged data keeps its reference", () => {
  it("for a query the patch doesn't cover", () => {
    const data = { anything: true };
    expect(patchLedgerData(["ledger", "budget-view", "2026-11-01"], data, { id: "t1", approved: true })).toBe(data);
  });

  it("when the transaction isn't in the cached list", () => {
    const data = home([pending({ id: "other" })]);
    expect(patchLedgerData(HOME_KEY, data, { id: "t1", approved: true })).toBe(data);
  });

  it("for missing data", () => {
    expect(patchLedgerData(HOME_KEY, undefined, { id: "t1", approved: true })).toBeUndefined();
  });
});

describe("home pending list", () => {
  it("drops a row once approved", () => {
    const data = home([pending(), pending({ id: "t2" })]);
    expect(pendingOf(patchLedgerData(HOME_KEY, data, { id: "t1", approved: true })).map((t) => t.id)).toEqual(["t2"]);
  });

  it("keeps an uncategorized row approved without a category (the server skips it)", () => {
    const data = home([pending({ categoryId: null, categoryLabel: null, allocationCount: 0, suggested: false })]);
    expect(pendingOf(patchLedgerData(HOME_KEY, data, { id: "t1", approved: true }))).toHaveLength(1);
  });

  it("drops an uncategorized row approved with a category", () => {
    const data = home([pending({ categoryId: null, categoryLabel: null, allocationCount: 0 })]);
    const patch: TxnPatch = { id: "t1", approved: true, category: { id: "food", name: "Food", replace: "none" } };
    expect(pendingOf(patchLedgerData(HOME_KEY, data, patch))).toHaveLength(0);
  });

  it("drops a deleted row", () => {
    expect(pendingOf(patchLedgerData(HOME_KEY, home([pending()]), { id: "t1", deleted: true }))).toHaveLength(0);
  });

  it("updates a row that stays pending", () => {
    const patch: TxnPatch = { id: "t1", approved: false, allocations: [], payee: "Coffee Shop", amountCents: -500 };
    expect(pendingOf(patchLedgerData(HOME_KEY, home([pending()]), patch))[0]).toMatchObject({
      payee: "Coffee Shop",
      amountCents: -500,
      categoryLabel: null,
      categoryId: null,
      allocationCount: 0,
      suggested: false,
    });
  });

  it("drops a row an edit approves with no category (an off-budget line)", () => {
    const data = home([pending({ categoryId: null, categoryLabel: null, allocationCount: 0 })]);
    const patch: TxnPatch = { id: "t1", approved: true, allocations: [] };
    expect(pendingOf(patchLedgerData(HOME_KEY, data, patch))).toHaveLength(0);
  });

  it("labels a split by its count", () => {
    const patch: TxnPatch = {
      id: "t1",
      allocations: [
        { categoryId: "a", name: "A", amountCents: -200 },
        { categoryId: "b", name: "B", amountCents: -250 },
      ],
    };
    expect(pendingOf(patchLedgerData(HOME_KEY, home([pending()]), patch))[0]).toMatchObject({
      categoryLabel: "Split (2)",
      categoryId: null,
      allocationCount: 2,
    });
  });
});

describe("category replace rules (mirroring bulkApproveTransactions)", () => {
  const category = (replace: "none" | "unsplit" | "all") => ({ id: "food", name: "Food", replace });

  it('"none" leaves a categorized row as it is', () => {
    const out = pendingOf(patchLedgerData(HOME_KEY, home([pending()]), { id: "t1", category: category("none") }));
    expect(out[0]).toMatchObject({ categoryId: "dining", categoryLabel: "Dining", suggested: true });
  });

  it('"unsplit" replaces a single category but keeps a split', () => {
    const data = home([pending(), pending({ id: "t2", categoryId: null, categoryLabel: "Split (2)", allocationCount: 2 })]);
    const out = pendingOf(patchLedgerDataAll(HOME_KEY, data, [
      { id: "t1", category: category("unsplit") },
      { id: "t2", category: category("unsplit") },
    ]));
    expect(out.map((t) => t.categoryLabel)).toEqual(["Food", "Split (2)"]);
  });

  it('"all" replaces a split too', () => {
    const data = home([pending({ categoryId: null, categoryLabel: "Split (2)", allocationCount: 2 })]);
    expect(pendingOf(patchLedgerData(HOME_KEY, data, { id: "t1", category: category("all") }))[0]).toMatchObject({
      categoryId: "food",
      categoryLabel: "Food",
      allocationCount: 1,
    });
  });
});

describe("transaction lists", () => {
  it("marks a row approved and no longer suggested", () => {
    expect(rowsOf(patchLedgerData(ALL_KEY, allTxns([row()]), { id: "t1", approved: true }))[0]).toMatchObject({
      approved: true,
      suggested: false,
      needsCategory: false,
      categoryLabel: "Dining",
    });
  });

  it("categorizes a pending row without approving it", () => {
    const data = allTxns([row({ categoryLabel: "Uncategorized", suggested: false, needsCategory: true })]);
    const patch: TxnPatch = { id: "t1", category: { id: "food", name: "Food", replace: "all" } };
    expect(rowsOf(patchLedgerData(ALL_KEY, data, patch))[0]).toMatchObject({
      approved: false,
      categoryLabel: "Food",
      suggested: false,
      needsCategory: false,
    });
  });

  it("shows an edit's fields and account", () => {
    const patch: TxnPatch = {
      id: "t1",
      payee: "Bakery",
      memo: "bread",
      cleared: true,
      txnDate: "2026-11-02",
      accountId: "savings",
      accountName: "Savings",
      allocations: [],
      approved: false,
    };
    expect(rowsOf(patchLedgerData(ALL_KEY, allTxns([row()]), patch))[0]).toMatchObject({
      payee: "Bakery",
      memo: "bread",
      cleared: true,
      txnDate: "2026-11-02",
      accountId: "savings",
      accountName: "Savings",
      categoryLabel: "Uncategorized",
      needsCategory: true,
    });
  });

  it("removes a deleted row", () => {
    expect(rowsOf(patchLedgerData(ALL_KEY, allTxns([row(), row({ id: "t2" })]), { id: "t1", deleted: true }))).toHaveLength(1);
  });

  it("takes a row moved to another account out of its old register only", () => {
    const patch: TxnPatch = { id: "t1", accountId: "savings" };
    expect(rowsOf(patchLedgerData(registerKey("checking"), register([row()]), patch))).toHaveLength(0);
    expect(rowsOf(patchLedgerData(registerKey("savings"), register([row()]), patch))).toHaveLength(1);
  });
});

describe("transaction detail", () => {
  it("approves with a category for the full amount", () => {
    const patch: TxnPatch = { id: "t1", approved: true, category: { id: "food", name: "Food", replace: "all" } };
    expect(txnOf(patchLedgerData(detailKey("t1"), detail(), patch))).toMatchObject({
      isApproved: true,
      categoryId: "food",
      categorySource: null,
      allocations: [{ categoryId: "food", amountCents: -450 }],
    });
  });

  it("keeps the cleared time of an already-cleared transaction", () => {
    const data = detail({ clearedAt: "2026-11-01T10:00:00Z" });
    expect(txnOf(patchLedgerData(detailKey("t1"), data, { id: "t1", cleared: true }))?.clearedAt).toBe(
      "2026-11-01T10:00:00Z",
    );
    expect(txnOf(patchLedgerData(detailKey("t1"), data, { id: "t1", cleared: false }))?.clearedAt).toBeNull();
  });

  it("clears the transaction once deleted", () => {
    expect(txnOf(patchLedgerData(detailKey("t1"), detail(), { id: "t1", deleted: true }))).toBeNull();
  });

  it("leaves another transaction's detail alone", () => {
    const data = detail();
    expect(patchLedgerData(detailKey("t1"), data, { id: "t2", approved: true })).toBe(data);
  });
});
