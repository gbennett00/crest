"use client";

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { afterNextPaint, type startFlow } from "@/lib/perf";
import { invalidateAllLedgerQueries, LEDGER_ROOT } from "./define-query";
import { patchLedgerDataAll, type TxnPatch } from "./txn-patch";
import { showSaveError } from "./save-error-store";

// Optimistic transaction writes: every cached list the transaction appears in
// is patched the moment the user saves, and the server action runs behind it.
//
// While an action is in flight its patches stay registered here, and the
// layer installed by installOptimisticLayer re-applies them to any fetch
// result that lands in the meantime (a mount refetch on the screen the user
// navigated to, another save's refetch). Otherwise such a fetch, answered
// before the write committed, would briefly bring the old row back.
//
// Module-level because the app has exactly one QueryClient (lib/query-client.tsx).

const inFlight = new Map<number, TxnPatch[]>();
let nextId = 0;

function applyInFlight(key: QueryKey, data: unknown): unknown {
  let next = data;
  for (const patches of inFlight.values()) next = patchLedgerDataAll(key, next, patches);
  return next;
}

/** Re-applies in-flight patches to fetch results. Returns the unsubscribe. */
export function installOptimisticLayer(queryClient: QueryClient) {
  return queryClient.getQueryCache().subscribe((event) => {
    if (inFlight.size === 0) return;
    if (event.type !== "updated" || event.action.type !== "success") return;
    // Our own setQueryData calls (and anyone else's) are already final.
    if (event.action.manual) return;
    const { queryKey } = event.query;
    if (queryKey[0] !== LEDGER_ROOT[0]) return;
    const data = event.query.state.data;
    const patched = applyInFlight(queryKey, data);
    if (patched !== data) queryClient.setQueryData(queryKey, patched);
  });
}

type Flow = ReturnType<typeof startFlow>;

/**
 * Patches the cache with `patches`, then runs `action`. On failure (it
 * throws, or `errorOf` returns a message) the patched queries are restored,
 * the error is shown in the global save-error banner, and the ledger is
 * refetched. Either way the ledger is refetched afterwards so derived numbers
 * (balances, activity, Ready to Assign) catch up.
 *
 * Returns once the cache is patched; the action continues in the background.
 */
export function runOptimistic<R>(
  queryClient: QueryClient,
  {
    patches,
    action,
    errorOf,
    onSuccess,
    failure,
    flow,
  }: {
    patches: TxnPatch[];
    action: () => Promise<R>;
    /** The failure message for a result, or null when it succeeded. */
    errorOf: (result: R) => string | null | undefined;
    onSuccess?: (result: R) => void;
    /** Shown with the failure message, e.g. "Couldn’t save Coffee Co." and a retry link. */
    failure?: { title?: string; retryHref?: string };
    /** Phase 0 timing: records `optimistic`, `action` and `refetch` steps. */
    flow?: Flow;
  },
) {
  const id = nextId++;
  const filters = { queryKey: LEDGER_ROOT };

  // An in-flight fetch could land over the patch with pre-write data.
  void queryClient.cancelQueries(filters);
  inFlight.set(id, patches);
  // What each patched query held before, to put back if the write fails.
  const snapshot: [QueryKey, unknown][] = [];
  for (const [key, data] of queryClient.getQueriesData(filters)) {
    const patched = patchLedgerDataAll(key, data, patches);
    if (patched === data) continue;
    snapshot.push([key, data]);
    queryClient.setQueryData(key, patched);
  }
  if (flow) void afterNextPaint().then(() => flow.step("optimistic"));

  void (async () => {
    let message: string | null | undefined;
    let result: R | undefined;
    try {
      result = await action();
      message = errorOf(result);
    } catch (err) {
      console.error(err);
      message = "Something went wrong.";
    }

    inFlight.delete(id);

    if (message) {
      // Put back what this write changed, keeping other writes still in flight.
      for (const [key, data] of snapshot) {
        queryClient.setQueryData(key, applyInFlight(key, data));
      }
      showSaveError({ title: failure?.title, message, retryHref: failure?.retryHref });
    } else {
      flow?.step("action");
      onSuccess?.(result as R);
    }

    // Refetching now (rather than before deleting the patch) also corrects
    // rows the server skipped, e.g. a bulk approve's uncategorized rows.
    await invalidateAllLedgerQueries(queryClient);
    if (!message) flow?.step("refetch");
  })();
}
