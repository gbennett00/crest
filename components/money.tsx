"use client";

import { formatCents } from "@/lib/format";
import { usePrivacyMode } from "@/lib/privacy-mode";

const MASKED = "$XX.XX";

export function Money({ cents, sign }: { cents: number; sign?: boolean }) {
  const { privacyMode } = usePrivacyMode();

  if (privacyMode) {
    const prefix = sign && cents > 0 ? "+" : cents < 0 ? "-" : "";
    return <>{prefix}{MASKED}</>;
  }

  if (sign && cents > 0) return <>+{formatCents(cents)}</>;
  return <>{formatCents(cents)}</>;
}

export function useFormattedCents() {
  const { privacyMode } = usePrivacyMode();
  return (cents: number) => (privacyMode ? MASKED : formatCents(cents));
}
