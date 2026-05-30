import { describe, expect, it } from "vitest";

import {
  approximateAvailableCents,
  sumClearedTransactionAmounts,
  sumPendingTransactionAmounts,
  sumTransactionAmounts,
} from "./balance";

const line = (amountCents: number, cleared: boolean) => ({
  amountCents,
  clearedAt: cleared ? "2026-05-01T00:00:00Z" : null,
});

describe("sumTransactionAmounts", () => {
  it("sums signed ledger amounts", () => {
    expect(sumTransactionAmounts([-5000, 10000, -2500])).toBe(2500);
  });
});

describe("sumPendingTransactionAmounts", () => {
  it("sums only uncleared lines", () => {
    expect(
      sumPendingTransactionAmounts([
        line(-2000, false),
        line(500, true),
        line(-1000, false),
      ]),
    ).toBe(-3000);
  });
});

describe("sumClearedTransactionAmounts", () => {
  it("sums only cleared lines including opening balance", () => {
    expect(
      sumClearedTransactionAmounts([
        line(10_000, true),
        line(-5000, true),
        line(-2500, false),
      ]),
    ).toBe(5000);
  });
});

describe("approximateAvailableCents", () => {
  it("adds bank cleared balance to pending register activity", () => {
    expect(
      approximateAvailableCents(5000, [
        line(10_000, true),
        line(-2500, false),
        line(-5000, true),
      ]),
    ).toBe(2500);
  });
});
