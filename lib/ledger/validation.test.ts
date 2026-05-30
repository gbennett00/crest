import { describe, expect, it } from "vitest";

import { LedgerError } from "./errors";
import {
  sumAllocationCents,
  validateAllocations,
  validateCreditAccount,
  validateTransferAccounts,
} from "./validation";

describe("validateAllocations", () => {
  it("allows no splits on unapproved transactions", () => {
    expect(() =>
      validateAllocations(-5000, undefined, null),
    ).not.toThrow();
  });

  it("requires splits when approved", () => {
    expect(() => validateAllocations(-5000, [], "2026-05-01T00:00:00Z")).toThrow(
      LedgerError,
    );
  });

  it("requires split sum to match transaction amount", () => {
    expect(() =>
      validateAllocations(-5000, [{ categoryId: "c1", amountCents: -3000 }], null),
    ).toThrow(/sum to transaction amount/);

    expect(() =>
      validateAllocations(
        -5000,
        [
          { categoryId: "c1", amountCents: -3000 },
          { categoryId: "c2", amountCents: -2000 },
        ],
        null,
      ),
    ).not.toThrow();
  });

  it("rejects zero allocation amounts", () => {
    expect(() =>
      validateAllocations(-5000, [{ categoryId: "c1", amountCents: 0 }], null),
    ).toThrow(/cannot be zero/);
  });
});

describe("sumAllocationCents", () => {
  it("sums signed split amounts", () => {
    expect(
      sumAllocationCents([
        { categoryId: "a", amountCents: -3000 },
        { categoryId: "b", amountCents: -2000 },
      ]),
    ).toBe(-5000);
  });
});

describe("validateCreditAccount", () => {
  it("requires payment category for credit", () => {
    expect(() => validateCreditAccount("credit", null)).toThrow(
      /paymentCategoryId/,
    );
  });

  it("forbids payment category on non-credit", () => {
    expect(() => validateCreditAccount("checking", "cat-1")).toThrow(
      /only credit/,
    );
  });
});

describe("validateTransferAccounts", () => {
  it("rejects same-account transfers", () => {
    expect(() =>
      validateTransferAccounts("same", "same"),
    ).toThrow(/must differ/);
  });
});
