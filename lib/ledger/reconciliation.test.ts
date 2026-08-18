import { describe, expect, it } from "vitest";

import { checkReconciliation } from "./reconciliation";

describe("checkReconciliation", () => {
  it("passes when bank cleared matches the register cleared balance", () => {
    const result = checkReconciliation({
      bankClearedBalanceCents: 5000,
      registerClearedBalanceCents: 5000,
    });
    expect(result).toEqual({ ok: true });
  });

  it("reports difference when bank and register diverge", () => {
    const result = checkReconciliation({
      bankClearedBalanceCents: 5500,
      registerClearedBalanceCents: 5000,
    });
    expect(result).toEqual({
      ok: false,
      differenceCents: 500,
      registerClearedBalanceCents: 5000,
      bankClearedBalanceCents: 5500,
    });
  });

  it("reports a negative difference when the register exceeds the bank", () => {
    const result = checkReconciliation({
      bankClearedBalanceCents: 1000,
      registerClearedBalanceCents: 1500,
    });
    expect(result).toEqual({
      ok: false,
      differenceCents: -500,
      registerClearedBalanceCents: 1500,
      bankClearedBalanceCents: 1000,
    });
  });
});
