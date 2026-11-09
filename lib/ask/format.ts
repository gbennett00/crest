/** Column order from the result rows (first row's keys, then any extras). */
export function resultColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

export function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** "0.18¢" for typical queries, dollars once it gets past a dollar. */
export function formatCost(usd: number): string {
  const cents = usd * 100;
  if (cents < 0.01) return "<0.01¢";
  if (cents < 100) return `${cents.toFixed(2)}¢`;
  return `$${usd.toFixed(2)}`;
}
