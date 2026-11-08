import { PerfLog } from "@/components/dev/perf-log";

// Unlike the other /dev pages this one is available in production on
// purpose: the Phase 0 baseline (docs/instant-feel-plan.md) has to be
// measured on the real deployment from a phone. It only reads timings this
// device recorded in its own localStorage.
export default function PerfPage() {
  return <PerfLog />;
}
