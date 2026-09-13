import { describe, expect, it } from "vitest";

import {
  MATCH_WINDOW_DAYS,
  selectAdoptionMatch,
  type AdoptionCandidate,
} from "./match";

describe("selectAdoptionMatch", () => {
  it("matches an exact amount on the same date", () => {
    const candidates: AdoptionCandidate[] = [
      { id: "a", amountCents: -1250, txnDate: "2026-01-10" },
    ];
    const idx = selectAdoptionMatch(
      { amountCents: -1250, txnDate: "2026-01-10" },
      candidates,
    );
    expect(idx).toBe(0);
  });

  it("does not match when amounts differ, even by one cent", () => {
    const candidates: AdoptionCandidate[] = [
      { id: "a", amountCents: -1251, txnDate: "2026-01-10" },
    ];
    const idx = selectAdoptionMatch(
      { amountCents: -1250, txnDate: "2026-01-10" },
      candidates,
    );
    expect(idx).toBe(-1);
  });

  it("matches within the date window on either side", () => {
    const before: AdoptionCandidate[] = [
      { id: "a", amountCents: -500, txnDate: "2026-03-01" },
    ];
    const after: AdoptionCandidate[] = [
      { id: "b", amountCents: -500, txnDate: "2026-03-08" },
    ];
    // Plaid date 4 days after / before the candidate — both within window.
    expect(
      selectAdoptionMatch({ amountCents: -500, txnDate: "2026-03-05" }, before),
    ).toBe(0);
    expect(
      selectAdoptionMatch({ amountCents: -500, txnDate: "2026-03-04" }, after),
    ).toBe(0);
  });

  it("rejects a candidate just outside the date window", () => {
    const candidates: AdoptionCandidate[] = [
      { id: "a", amountCents: -500, txnDate: "2026-03-01" },
    ];
    // 5 days apart, window is 4.
    const idx = selectAdoptionMatch(
      { amountCents: -500, txnDate: "2026-03-06" },
      candidates,
    );
    expect(idx).toBe(-1);
  });

  it("prefers the candidate with the closest date", () => {
    const candidates: AdoptionCandidate[] = [
      { id: "far", amountCents: -900, txnDate: "2026-05-01" },
      { id: "near", amountCents: -900, txnDate: "2026-05-04" },
    ];
    const idx = selectAdoptionMatch(
      { amountCents: -900, txnDate: "2026-05-05" },
      candidates,
    );
    expect(candidates[idx].id).toBe("near");
  });

  it("breaks ties deterministically toward the earlier date", () => {
    // Both are 2 days from the Plaid date (one before, one after).
    const candidates: AdoptionCandidate[] = [
      { id: "after", amountCents: -900, txnDate: "2026-05-12" },
      { id: "before", amountCents: -900, txnDate: "2026-05-08" },
    ];
    const idx = selectAdoptionMatch(
      { amountCents: -900, txnDate: "2026-05-10" },
      candidates,
    );
    expect(candidates[idx].id).toBe("before");
  });

  it("returns -1 for an empty candidate list", () => {
    expect(
      selectAdoptionMatch({ amountCents: -100, txnDate: "2026-01-01" }, []),
    ).toBe(-1);
  });

  it("matches inflows (positive amounts) the same way", () => {
    const candidates: AdoptionCandidate[] = [
      { id: "paycheck", amountCents: 250_000, txnDate: "2026-02-15" },
    ];
    const idx = selectAdoptionMatch(
      { amountCents: 250_000, txnDate: "2026-02-16" },
      candidates,
    );
    expect(idx).toBe(0);
  });

  it("supports one-to-one consumption across repeated same-amount txns", () => {
    // Two identical $4.50 coffees on the same day; each Plaid txn should take a
    // distinct candidate when the caller removes matches between calls.
    const candidates: AdoptionCandidate[] = [
      { id: "c1", amountCents: -450, txnDate: "2026-06-01" },
      { id: "c2", amountCents: -450, txnDate: "2026-06-01" },
    ];

    const first = selectAdoptionMatch(
      { amountCents: -450, txnDate: "2026-06-01" },
      candidates,
    );
    const firstId = candidates[first].id;
    candidates.splice(first, 1);

    const second = selectAdoptionMatch(
      { amountCents: -450, txnDate: "2026-06-01" },
      candidates,
    );
    const secondId = candidates[second].id;

    expect(new Set([firstId, secondId])).toEqual(new Set(["c1", "c2"]));
  });

  it("exposes a sane default window", () => {
    expect(MATCH_WINDOW_DAYS).toBeGreaterThanOrEqual(1);
  });
});
