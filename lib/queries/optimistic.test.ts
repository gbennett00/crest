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

// Lets the runner's background work (action, then refetch) proceed.
const flush = () => new Promise((r) => setTimeout(r, 0));

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
});
