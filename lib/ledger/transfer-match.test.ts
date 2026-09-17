import { describe, expect, it } from "vitest";

import {
  TRANSFER_LINK_WINDOW_DAYS,
  selectTransferLinkMatch,
  type TransferLinkCandidate,
} from "./transfer-match";

describe("selectTransferLinkMatch", () => {
  it("matches an exact opposite amount on the same date", () => {
    const candidates: TransferLinkCandidate[] = [
      { id: "a", amountCents: 5000, txnDate: "2026-01-10" },
    ];
    const idx = selectTransferLinkMatch(
      { amountCents: -5000, txnDate: "2026-01-10" },
      candidates,
    );
    expect(idx).toBe(0);
  });

  it("does not match a same-sign amount, even if equal magnitude", () => {
    const candidates: TransferLinkCandidate[] = [
      { id: "a", amountCents: -5000, txnDate: "2026-01-10" },
    ];
    const idx = selectTransferLinkMatch(
      { amountCents: -5000, txnDate: "2026-01-10" },
      candidates,
    );
    expect(idx).toBe(-1);
  });

  it("does not match when magnitudes differ, even by one cent", () => {
    const candidates: TransferLinkCandidate[] = [
      { id: "a", amountCents: 5001, txnDate: "2026-01-10" },
    ];
    const idx = selectTransferLinkMatch(
      { amountCents: -5000, txnDate: "2026-01-10" },
      candidates,
    );
    expect(idx).toBe(-1);
  });

  it("matches within the date window on either side", () => {
    const before: TransferLinkCandidate[] = [
      { id: "a", amountCents: 500, txnDate: "2026-03-01" },
    ];
    const after: TransferLinkCandidate[] = [
      { id: "b", amountCents: 500, txnDate: "2026-03-08" },
    ];
    expect(
      selectTransferLinkMatch({ amountCents: -500, txnDate: "2026-03-05" }, before),
    ).toBe(0);
    expect(
      selectTransferLinkMatch({ amountCents: -500, txnDate: "2026-03-04" }, after),
    ).toBe(0);
  });

  it("rejects a candidate just outside the date window", () => {
    const candidates: TransferLinkCandidate[] = [
      { id: "a", amountCents: 500, txnDate: "2026-03-01" },
    ];
    const idx = selectTransferLinkMatch(
      { amountCents: -500, txnDate: "2026-03-06" },
      candidates,
    );
    expect(idx).toBe(-1);
  });

  it("prefers the candidate with the closest date", () => {
    const candidates: TransferLinkCandidate[] = [
      { id: "far", amountCents: 500, txnDate: "2026-03-01" },
      { id: "near", amountCents: 500, txnDate: "2026-03-04" },
    ];
    const idx = selectTransferLinkMatch(
      { amountCents: -500, txnDate: "2026-03-05" },
      candidates,
    );
    expect(candidates[idx].id).toBe("near");
  });

  it("breaks ties on equal distance by the earliest date", () => {
    const candidates: TransferLinkCandidate[] = [
      { id: "later", amountCents: 500, txnDate: "2026-03-07" },
      { id: "earlier", amountCents: 500, txnDate: "2026-03-03" },
    ];
    const idx = selectTransferLinkMatch(
      { amountCents: -500, txnDate: "2026-03-05" },
      candidates,
    );
    expect(candidates[idx].id).toBe("earlier");
  });

  it("honors a custom window", () => {
    const candidates: TransferLinkCandidate[] = [
      { id: "a", amountCents: 500, txnDate: "2026-03-01" },
    ];
    expect(
      selectTransferLinkMatch(
        { amountCents: -500, txnDate: "2026-03-03" },
        candidates,
        1,
      ),
    ).toBe(-1);
    expect(
      selectTransferLinkMatch(
        { amountCents: -500, txnDate: "2026-03-03" },
        candidates,
        2,
      ),
    ).toBe(0);
  });

  it("ignores unrelated amounts", () => {
    const candidates: TransferLinkCandidate[] = [
      { id: "a", amountCents: 1234, txnDate: "2026-01-10" },
    ];
    expect(
      selectTransferLinkMatch({ amountCents: -5000, txnDate: "2026-01-10" }, candidates),
    ).toBe(-1);
  });

  it("exports the default window size", () => {
    expect(TRANSFER_LINK_WINDOW_DAYS).toBe(4);
  });
});
