"use client";

import { useEffect, useRef } from "react";
import { markFirstContent, startFlow } from "./perf";

/**
 * Phase 0 timing (docs/instant-feel-plan.md) for a cached screen:
 *
 * - `first-content:<screen>`: navigation start → first render with real data,
 *   recorded only if this is the first screen of the document load (a cold
 *   launch or reload).
 * - `stale-shown:<screen>`: how long the screen showed cached data while a
 *   refetch was in flight right after mounting, e.g. arriving back on Home
 *   after approving a transaction from its edit page, where the approved row
 *   stays visible until the refetch lands. Recorded once per mount.
 */
export function useScreenTiming(
  screen: string,
  { hasData, isFetching }: { hasData: boolean; isFetching: boolean },
) {
  const staleFlow = useRef<ReturnType<typeof startFlow> | null>(null);
  const staleChecked = useRef(false);

  useEffect(() => {
    if (!hasData) return;
    markFirstContent(screen);

    if (!staleChecked.current) {
      staleChecked.current = true;
      if (isFetching) staleFlow.current = startFlow("stale-shown");
    } else if (staleFlow.current && !isFetching) {
      staleFlow.current.step(screen);
      staleFlow.current = null;
    }
  }, [screen, hasData, isFetching]);
}
