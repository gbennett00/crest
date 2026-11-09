import { afterEach, describe, expect, it } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { HomeData, PendingTransaction } from "@/lib/budget";
import { installOptimisticLayer, runOptimistic } from "./optimistic";
import { clearSaveError, getSaveError } from "./save-error-store";

const HOME_KEY = ["ledger", "home-view"];

function pending(id: string): PendingTransaction {
  return {
    id,
    payee: `Payee ${id}`,
    amountCents: -1000,
    txnDate: "2026-11-01",
    accountName: "Checking",
    categoryLabel: "Dining",
    suggested: false,
    categoryId: "dining",
    allocationCount: 1,
    suggestedCategoryIds: [],
  };
}

const home = (...ids: string[]) => ({ pending: ids.map(pending) }) as unknown as HomeData;
const pendingIds = (qc: QueryClient) =>
  qc.getQueryData<HomeData>(HOME_KEY)?.pending.map((t) => t.id);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// Lets the runner's background work (action, cancel, refetch) proceed.
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

const cleanups: (() => void)[] = [];

/** A client whose home-view starts as `cached` and refetches `server.pending`. */
function setup(cached: string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cleanups.push(installOptimisticLayer(qc));
  const server = { pending: cached };
  qc.setQueryData(HOME_KEY, home(...cached));
  // An observer keeps home-view active, so invalidation refetches it (as the
  // global Add button's observer does in the app). staleTime stops it
  // fetching just for subscribing.
  const observer = new QueryObserver(qc, {
    queryKey: HOME_KEY,
    queryFn: async () => home(...server.pending),
    staleTime: Infinity,
  });
  cleanups.push(observer.subscribe(() => {}));
  return { qc, server };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  clearSaveError();
});

describe("runOptimistic", () => {
  it("patches the cache before the action resolves, then refetches", async () => {
    const { qc, server } = setup(["t1", "t2"]);
    const action = deferred<{ error?: string }>();

    runOptimistic(qc, {
      patches: [{ id: "t1", approved: true }],
      action: () => action.promise,
      errorOf: (r) => r.error,
    });
    expect(pendingIds(qc)).toEqual(["t2"]);

    server.pending = ["t2"];
    action.resolve({});
    await flush();
    expect(pendingIds(qc)).toEqual(["t2"]);
    expect(getSaveError()).toBeNull();
  });

  it("restores the cache when the action fails", async () => {
    const { qc } = setup(["t1", "t2"]);

    runOptimistic(qc, {
      patches: [{ id: "t1", approved: true }],
      action: async () => ({ error: "Nope" }),
      errorOf: (r) => r.error,
      failure: { title: "Couldn’t approve." },
    });
    expect(pendingIds(qc)).toEqual(["t2"]);
    await flush();
    expect(pendingIds(qc)).toEqual(["t1", "t2"]);
    expect(getSaveError()).toEqual({ title: "Couldn’t approve.", message: "Nope", retryHref: undefined });
  });

  it("restores the cache when the action throws", async () => {
    const { qc } = setup(["t1"]);

    runOptimistic(qc, {
      patches: [{ id: "t1", deleted: true }],
      action: async () => {
        throw new Error("network");
      },
      errorOf: () => null,
    });
    await flush();
    expect(pendingIds(qc)).toEqual(["t1"]);
    expect(getSaveError()?.message).toBe("Something went wrong.");
  });

  it("keeps the patch over a fetch that lands while the action is in flight", async () => {
    const { qc } = setup(["t1", "t2"]);
    const action = deferred<{ error?: string }>();

    runOptimistic(qc, {
      patches: [{ id: "t1", approved: true }],
      action: () => action.promise,
      errorOf: (r) => r.error,
    });

    // The server hasn't committed yet, so a refetch still returns t1.
    await qc.refetchQueries({ queryKey: HOME_KEY });
    expect(pendingIds(qc)).toEqual(["t2"]);

    action.resolve({});
    await flush();
  });

  it("brings back rows the server skipped", async () => {
    const { qc, server } = setup(["t1", "t2"]);
    const action = deferred<{ error?: string }>();

    runOptimistic(qc, {
      patches: [{ id: "t1", approved: true }, { id: "t2", approved: true }],
      action: () => action.promise,
      errorOf: (r) => r.error,
    });
    expect(pendingIds(qc)).toEqual([]);

    // Only t1 was approved; t2 was skipped.
    server.pending = ["t2"];
    action.resolve({});
    await flush();
    expect(pendingIds(qc)).toEqual(["t2"]);
  });

  it("doesn't stall an unrelated query's first load", async () => {
    const { qc } = setup(["t1"]);
    const load = deferred<string>();
    const other = new QueryObserver(qc, { queryKey: ["ledger", "budget-view", "2026-11-01"], queryFn: () => load.promise });
    cleanups.push(other.subscribe(() => {}));
    expect(other.getCurrentResult().fetchStatus).toBe("fetching");

    const action = deferred<{ error?: string }>();
    runOptimistic(qc, {
      patches: [{ id: "t1", approved: true }],
      action: () => action.promise,
      errorOf: (r) => r.error,
    });
    await flush();
    expect(other.getCurrentResult().fetchStatus).toBe("fetching");
    load.resolve("loaded");
    await flush();
    expect(other.getCurrentResult().data).toBe("loaded");

    // Patches are module-level: let this write finish so it can't leak.
    action.resolve({});
    await flush();
  });

  it("doesn't undo a newer write that succeeded when an older one fails", async () => {
    const { qc, server } = setup(["t1", "t2"]);
    const older = deferred<{ error?: string }>();
    const newer = deferred<{ error?: string }>();

    runOptimistic(qc, {
      patches: [{ id: "t1", approved: true }],
      action: () => older.promise,
      errorOf: (r) => r.error,
    });
    runOptimistic(qc, {
      patches: [{ id: "t2", approved: true }],
      action: () => newer.promise,
      errorOf: (r) => r.error,
    });
    expect(pendingIds(qc)).toEqual([]);

    server.pending = ["t1"];
    newer.resolve({});
    await flush();

    // Record every state the list passes through once the older write fails.
    const seen: (string[] | undefined)[] = [];
    cleanups.push(qc.getQueryCache().subscribe(() => seen.push(pendingIds(qc))));
    older.resolve({ error: "Nope" });
    await flush();

    expect(seen.some((ids) => ids?.includes("t2"))).toBe(false);
    expect(pendingIds(qc)).toEqual(["t1"]);
  });

  it("cancels an inactive prefetch that started before the write committed", async () => {
    const { qc } = setup(["t1"]);
    const registerKey = ["ledger", "account-register", "checking", undefined, undefined];
    const stale = deferred<unknown>();
    const action = deferred<{ error?: string }>();

    runOptimistic(qc, {
      patches: [{ id: "t1", deleted: true }],
      action: () => action.promise,
      errorOf: (r) => r.error,
    });
    // A hover prefetch starts mid-write, answered from before the delete.
    void qc.prefetchQuery({ queryKey: registerKey, queryFn: () => stale.promise });

    action.resolve({});
    await flush();
    stale.resolve({ txns: [{ id: "t1" }] });
    await flush();
    expect(qc.getQueryData(registerKey)).toBeUndefined();
  });
});
