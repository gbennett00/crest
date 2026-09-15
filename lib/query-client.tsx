"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
