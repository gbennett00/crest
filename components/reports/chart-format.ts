import { usePrivacyMode } from "@/lib/privacy-mode";

/** Compact axis label, e.g. 923_400 -> "$9K". Not for money a user needs to read exactly. */
export function formatCompactCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Privacy-mode-aware version of formatCompactCents, for chart axis labels. */
export function useFormattedCompactCents() {
  const { privacyMode } = usePrivacyMode();
  return (cents: number) => (privacyMode ? "$XX" : formatCompactCents(cents));
}
