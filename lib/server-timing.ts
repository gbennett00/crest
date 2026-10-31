// Server-side timing for the instant-feel work (docs/instant-feel-plan.md,
// Phase 0). API routes send the spans as a `Server-Timing` header, which
// browser devtools show per request under Network → Timing. Server Actions
// can't set response headers, so they log instead. Logging is off unless
// CREST_TIMING=1, because some routes (e.g. /api/budget-view, which the
// budget screen prefetches about a year of months through) are hit often.

export type ServerTimer = ReturnType<typeof createServerTimer>;

type Span = { name: string; ms: number };

// Server-Timing metric names must be HTTP tokens.
function toToken(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function createServerTimer(label: string) {
  const start = performance.now();
  const spans: Span[] = [];

  return {
    /** Runs `fn`, recording its duration under `name` (even if it throws). */
    async time<T>(name: string, fn: () => PromiseLike<T>): Promise<T> {
      const s = performance.now();
      try {
        return await fn();
      } finally {
        spans.push({ name, ms: performance.now() - s });
      }
    },

    /** Value for a `Server-Timing` header: each span plus `total`. */
    header(): string {
      return formatServerTiming([
        ...spans,
        { name: "total", ms: performance.now() - start },
      ]);
    },

    /** Logs one line with every span, when CREST_TIMING=1. */
    log(meta?: Record<string, string | number | boolean>) {
      if (process.env.CREST_TIMING !== "1") return;
      const total = performance.now() - start;
      const parts = [
        `total=${total.toFixed(0)}ms`,
        ...spans.map((s) => `${s.name}=${s.ms.toFixed(0)}ms`),
        ...Object.entries(meta ?? {}).map(([k, v]) => `${k}=${v}`),
      ];
      console.info(`[timing] ${label} ${parts.join(" ")}`);
    },
  };
}

export function formatServerTiming(spans: Span[]): string {
  return spans.map((s) => `${toToken(s.name)};dur=${s.ms.toFixed(1)}`).join(", ");
}
