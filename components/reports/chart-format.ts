/** Compact axis label, e.g. 923_400 -> "$9K". Not for money a user needs to read exactly. */
export function formatCompactCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
