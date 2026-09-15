"use client";

import {
  useQuery,
  type QueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

// Every cached server resource in the app lives under this shared root, so a
// mutation that touches more than one screen (e.g. saving a transaction moves
// budget activity, account balances, and the home dashboard all at once) can
// invalidate everything with one cheap call instead of enumerating every
// affected key by hand. Invalidation only marks matching queries stale — it
// doesn't refetch anything that isn't currently mounted — so reaching for the
// broad form is the safe default; use a resource's own scoped `.key(...)`
// invalidation only for a genuinely hot path (see budget.ts's per-month
// assignCategory/assignGroup handling) where you want to skip refetching
// every other cached month.
export const LEDGER_ROOT = ["ledger"] as const;

export function invalidateAllLedgerQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: LEDGER_ROOT });
}

/**
 * Defines a cached resource backed by an API route: a `useQuery` hook, plus
 * `prefetch`/`invalidate` helpers that share the same query key. This is the
 * standard shape for any client-cached data in the app — see AGENTS.md
 * ("Client-side data caching") before adding a new one.
 */
export function defineQuery<TArgs extends unknown[], TData>(
  name: string,
  fetcher: (...args: TArgs) => Promise<TData>,
) {
  const key = (...args: TArgs) => [...LEDGER_ROOT, name, ...args] as const;

  function useResource(
    args: TArgs,
    options?: Omit<UseQueryOptions<TData>, "queryKey" | "queryFn">,
  ) {
    return useQuery({
      queryKey: key(...args),
      queryFn: () => fetcher(...args),
      ...options,
    });
  }

  function prefetch(queryClient: QueryClient, ...args: TArgs) {
    return queryClient.prefetchQuery({
      queryKey: key(...args),
      queryFn: () => fetcher(...args),
    });
  }

  // Omit the args to invalidate every cached variant of this resource (e.g.
  // every month of budget-view); pass them to invalidate just that one.
  function invalidate(queryClient: QueryClient, ...args: TArgs | []) {
    return queryClient.invalidateQueries({
      queryKey: args.length > 0 ? key(...(args as TArgs)) : [...LEDGER_ROOT, name],
    });
  }

  return { name, key, useResource, prefetch, invalidate };
}
