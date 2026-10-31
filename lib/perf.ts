// Client-side timing for the instant-feel work (docs/instant-feel-plan.md,
// Phase 0). Records how long user-facing flows take — e.g. tapping Approve
// until the row is gone — into a small localStorage ring buffer, so numbers
// can be collected on a real phone (installed PWA, no devtools) and read back
// at /dev/perf. Durations only; no transaction data is stored.

export type PerfMeta = Record<string, string | number | boolean>;

export type PerfEntry = {
  /** The user-facing flow, e.g. "bulk-approve" or "first-content". */
  flow: string;
  /** Milestone within the flow, e.g. "action" or "refetch". */
  step: string;
  /** Milliseconds from the start of the flow to this step. */
  ms: number;
  /** Wall-clock time the entry was recorded (epoch ms). */
  at: number;
  meta?: PerfMeta;
};

const STORAGE_KEY = "crest:perf";
const MAX_ENTRIES = 300;

export function readPerfEntries(): PerfEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PerfEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearPerfEntries() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode, blocked site data): nothing to clear.
  }
}

function recordPerf(entry: PerfEntry) {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[perf] ${entry.flow}:${entry.step} ${entry.ms.toFixed(0)}ms`, entry.meta ?? "");
  }
  try {
    const entries = [...readPerfEntries(), entry].slice(-MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Recording is best-effort and must never break the flow it measures.
  }
}

/**
 * Starts timing a flow. Call `step(name)` at each milestone; each records the
 * time since `startFlow` was called.
 */
export function startFlow(flow: string, meta?: PerfMeta) {
  const t0 = performance.now();
  return {
    step(step: string, extra?: PerfMeta) {
      recordPerf({
        flow,
        step,
        ms: performance.now() - t0,
        at: Date.now(),
        meta: meta || extra ? { ...meta, ...extra } : undefined,
      });
    },
  };
}

/** Resolves after the next frame has painted. */
export function afterNextPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  );
}

let firstContentRecorded = false;

/**
 * Records time from navigation start until the first screen in this document
 * load rendered real data (not a skeleton) — i.e. a cold launch or full
 * reload. Only counts when the screen is the URL the document was loaded at,
 * and only once per document: a client-side navigation (e.g. the redirect to
 * Home after signing in) is a screen switch, not a launch, and
 * `performance.now()` would include all the time spent on earlier screens.
 */
export function markFirstContent(screen: string) {
  if (firstContentRecorded || typeof window === "undefined") return;
  firstContentRecorded = true;
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (!nav || new URL(nav.name).pathname !== window.location.pathname) return;
  recordPerf({
    flow: "first-content",
    step: screen,
    ms: performance.now(),
    at: Date.now(),
    meta: {
      standalone: window.matchMedia("(display-mode: standalone)").matches,
      navType: nav.type,
    },
  });
}

export type PerfSummaryRow = {
  flow: string;
  step: string;
  count: number;
  medianMs: number;
  p90Ms: number;
  maxMs: number;
};

function percentile(sorted: number[], p: number): number {
  // Nearest-rank: the smallest value with at least p% of samples at or below it.
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

/** Groups entries by flow + step with median / p90 / max durations. */
export function summarizePerf(entries: PerfEntry[]): PerfSummaryRow[] {
  const groups = new Map<string, { flow: string; step: string; values: number[] }>();
  for (const e of entries) {
    const key = `${e.flow}\u0000${e.step}`;
    const group = groups.get(key) ?? { flow: e.flow, step: e.step, values: [] };
    group.values.push(e.ms);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ flow, step, values }) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        flow,
        step,
        count: sorted.length,
        medianMs: percentile(sorted, 50),
        p90Ms: percentile(sorted, 90),
        maxMs: sorted[sorted.length - 1],
      };
    })
    .sort((a, b) => a.flow.localeCompare(b.flow) || a.medianMs - b.medianMs);
}
