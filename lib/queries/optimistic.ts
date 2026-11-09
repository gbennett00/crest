"use client";

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { afterNextPaint, type startFlow } from "@/lib/perf";
import { invalidateAllLedgerQueries, LEDGER_ROOT } from "./define-query";
import { showSaveError } from "./save-error-store";

// Optimistic writes: every cached query the write shows up in is patched the
// moment the user saves, and the server action runs behind it. Patches come
// from lib/queries/txn-patch.ts (transactions) and lib/budget/assign-patch.ts
// (assignments). A patch must be safe to apply again to data that already
// includes the write.
//
// While an action is in flight its patch stays registered here, and the
// layer installed by installOptimisticLayer re-applies them to any fetch
// result that lands in the meantime (a mount refetch on the screen the user
// navigated to, another save's refetch). Otherwise such a fetch, answered
// before the write committed, would briefly bring the old row back.
//
// Module-level because the app has exactly one QueryClient (lib/query-client.tsx).

/** Returns `data` with a pending write applied, or `data` itself if untouched. */
export type LedgerPatch = (key: QueryKey, data: unknown) => unknown;

const inFlight = new Map<number, LedgerPatch>();
let nextId = 0;

function applyInFlight(key: QueryKey, data: unknown): unknown {
  let next = data;
  for (const patch of inFlight.values()) next = patch(key, next);
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
 * Patches the cache with `patch`, then runs `action`. On failure (it
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
    patch,
    action,
    errorOf,
    onSuccess,
    failure,
    flow,
  }: {
    patch: LedgerPatch;
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

  inFlight.set(id, patch);
  // What each patched query held before, to put back if the write fails.
  const snapshot: [QueryKey, unknown][] = [];
  for (const [key, data] of queryClient.getQueriesData(filters)) {
    const patched = patch(key, data);
    if (patched === data) continue;
    snapshot.push([key, data]);
    // Only the queries being patched: cancelling another query's first load
    // would leave it on its skeleton until the write finishes. (A patched
    // query's cancel restores the patch, since setQueryData resets what
    // cancelling reverts to.)
    void queryClient.cancelQueries({ queryKey: key, exact: true });
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

    // A fetch still in flight may have been answered before the write
    // committed. Once the patch is gone nothing would correct it, and an
    // inactive query (a hover prefetch) isn't refetched by the invalidation
    // below, so it would sit there marked fresh. Cancel them; invalidation
    // refetches the active ones.
    await queryClient.cancelQueries({ ...filters, fetchStatus: "fetching" });
    inFlight.delete(id);

    if (message) {
      // Put back what this write changed. The snapshot predates any write
      // started after this one, which may have succeeded since; restoring it
      // would undo theirs, so in that case leave it to the refetch below.
      const newerWriteStarted = nextId > id + 1;
      if (!newerWriteStarted) {
        for (const [key, data] of snapshot) {
          queryClient.setQueryData(key, applyInFlight(key, data));
        }
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
