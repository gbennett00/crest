"use client";

import { useEffect, useState } from "react";

/**
 * True only once the component has mounted on the client. Server-side render
 * and the client's very first (pre-hydration) render both return false.
 *
 * Gate a "render cached data if we already have it" branch on this before
 * checking a query's data — otherwise, if the query cache is already warm
 * from an earlier prefetch (e.g. the nav bar's eager prefetch in
 * components/nav.tsx, or a row's hover-prefetch), the client's true first
 * paint can show real content while the server — which has no knowledge of
 * the browser's cache — necessarily rendered the loading skeleton, and React
 * flags that mismatch and discards the server HTML. Delaying by one render
 * (server and the client's first pass both show the skeleton; a mount effect
 * then flips this to true) costs nothing perceptible but keeps hydration
 * clean.
 */
export function useHasMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
