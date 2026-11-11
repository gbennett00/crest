"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { installOptimisticLayer } from "./queries/optimistic";
import { connectPreloader } from "./queries/preload";

// One QueryClient per browser session, created lazily so it survives client
// re-renders (including the RSC round-trips triggered by Link navigation)
// without resetting the cache. Defaults are tuned for "instant nav, slower
// writes is fine": data stays fresh long enough that switching between
// already-visited screens never blocks on the network, and mutations
// invalidate only the specific keys they touch (see lib/queries/*) instead of
// nuking everything.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 30 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  // Keeps optimistic transaction writes on screen while their save is in
  // flight (see lib/queries/optimistic.ts).
  useEffect(() => installOptimisticLayer(client), [client]);
  // Lets background preloads wait for the app's own requests to finish
  // (see lib/queries/preload.ts).
  useEffect(() => connectPreloader(client), [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
