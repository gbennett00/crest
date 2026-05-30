import { describe, expect, it } from "vitest";

import { checkReconciliation } from "./reconciliation";

describe("checkReconciliation", () => {
  const cleared = (amountCents: number) => ({
    amountCents,
    clearedAt: "2026-05-01T12:00:00Z",
  });
  const pending = (amountCents: number) => ({
    amountCents,
    clearedAt: null,
  });

  it("passes when bank cleared matches sum of cleared txns", () => {
    const result = checkReconciliation({
      bankClearedBalanceCents: 5000,
      transactions: [cleared(10_000), cleared(-5000)],
    });
    expect(result).toEqual({ ok: true });
  });

  it("reports difference when bank and register diverge", () => {
    const result = checkReconciliation({
      bankClearedBalanceCents: 5500,
      transactions: [cleared(10_000), cleared(-5000)],
    });
    expect(result).toEqual({
      ok: false,
      differenceCents: 500,
      registerClearedBalanceCents: 5000,
      bankClearedBalanceCents: 5500,
    });
  });

  it("ignores pending transactions when reconciling", () => {
    const result = checkReconciliation({
      bankClearedBalanceCents: 1000,
      transactions: [cleared(1000), pending(99999)],
    });
    expect(result).toEqual({ ok: true });
  });
});
