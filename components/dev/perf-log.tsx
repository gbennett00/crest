"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  clearPerfEntries,
  readPerfEntries,
  summarizePerf,
  type PerfEntry,
} from "@/lib/perf";

function ms(value: number): string {
  return `${Math.round(value)} ms`;
}

// Reads back the timings lib/perf.ts records on this device, so a baseline
// can be collected on a phone without devtools (docs/instant-feel-plan.md,
// Phase 0).
export function PerfLog() {
  const [entries, setEntries] = useState<PerfEntry[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setEntries(readPerfEntries()), []);

  if (entries === null) return null;

  const summary = summarizePerf(entries);

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entries, null, 2));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function clear() {
    clearPerfEntries();
    setEntries([]);
    setCopied(false);
  }

  return (
    <div className="p-4 space-y-5 max-w-3xl">
      <div className="space-y-1">
        <h1 className="text-title text-ink">Performance log</h1>
        <p className="text-body text-ink-muted">
          Timings recorded on this device ({entries.length} entries). Durations
          only, no transaction data.
        </p>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={copy} disabled={entries.length === 0}>
          {copied ? "Copied" : "Copy JSON"}
        </Button>
        <Button size="sm" variant="outline" onClick={clear} disabled={entries.length === 0}>
          Clear
        </Button>
      </div>

      {summary.length === 0 ? (
        <p className="text-body text-ink-muted">
          Nothing recorded yet. Open the app, approve some transactions, then
          come back.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-ds-md border">
          <table className="w-full text-row-label">
            <thead className="bg-surface-sunken text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2">Flow</th>
                <th className="text-left px-3 py-2">Step</th>
                <th className="text-right px-3 py-2">n</th>
                <th className="text-right px-3 py-2">Median</th>
                <th className="text-right px-3 py-2">p90</th>
                <th className="text-right px-3 py-2">Max</th>
              </tr>
            </thead>
            <tbody className="divide-y text-ink">
              {summary.map((row) => (
                <tr key={`${row.flow}:${row.step}`}>
                  <td className="px-3 py-2">{row.flow}</td>
                  <td className="px-3 py-2">{row.step}</td>
                  <td className="px-3 py-2 text-right num">{row.count}</td>
                  <td className="px-3 py-2 text-right num">{ms(row.medianMs)}</td>
                  <td className="px-3 py-2 text-right num">{ms(row.p90Ms)}</td>
                  <td className="px-3 py-2 text-right num">{ms(row.maxMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
