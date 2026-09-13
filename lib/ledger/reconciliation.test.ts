import { describe, expect, it } from "vitest";

import { checkReconciliation, reconcileInitialView } from "./reconciliation";

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

describe("reconcileInitialView", () => {
  it("shows the manual confirm for unlinked accounts", () => {
    expect(reconcileInitialView(false, 5000, 5000)).toBe("manual");
  });

  it("shows the manual confirm for a linked account with no bank balance yet", () => {
    expect(reconcileInitialView(true, null, 5000)).toBe("manual");
  });

  it("shows 'matched' when a linked account's bank balance equals the cleared register", () => {
    expect(reconcileInitialView(true, 5000, 5000)).toBe("matched");
  });

  it("shows 'review' when a linked account's bank balance diverges", () => {
    expect(reconcileInitialView(true, 5500, 5000)).toBe("review");
  });

  it("matches on the cleared total regardless of pending activity", () => {
    // registerClearedBalanceCents already excludes pending, so a bank balance
    // equal to the cleared total is a match even with pending transactions live.
    expect(reconcileInitialView(true, 1000, 1000)).toBe("matched");
  });

  it("treats a zero bank balance as a real value, not 'unknown'", () => {
    expect(reconcileInitialView(true, 0, 0)).toBe("matched");
    expect(reconcileInitialView(true, 0, 500)).toBe("review");
  });
});
