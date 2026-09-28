/**
 * Throws, naming the first query that failed, instead of letting a failed
 * query's `data: null` read as "no rows". Without this, a query that errors —
 * e.g. one selecting a column the database hasn't been migrated to yet —
 * silently renders as an empty budget rather than as an error.
 */
export function throwOnQueryErrors(
  results: Record<string, { error?: { message: string } | null }>,
): void {
  for (const [name, res] of Object.entries(results)) {
    if (res.error) throw new Error(`Failed to load ${name}: ${res.error.message}`);
  }
}
