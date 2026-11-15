import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ createPlaidClient: vi.fn() }));
vi.mock("./sync", () => ({ syncItem: vi.fn() }));

import {
  itemConnectionFromRow,
  plaidErrorCode,
  statusPatchFromError,
  statusPatchFromItemGet,
  type ItemHealthRow,
} from "./item-status";

const NOW = new Date("2026-11-15T12:00:00Z");

// Only the fields statusPatchFromItemGet reads; the SDK type is much wider.
function itemGet(opts: {
  errorCode?: string;
  lastSuccess?: string | null;
  lastFailed?: string | null;
  consentExpires?: string | null;
}) {
  return {
    item: {
      error: opts.errorCode ? { error_code: opts.errorCode } : null,
      consent_expiration_time: opts.consentExpires ?? null,
    },
    status: {
      transactions: {
        last_successful_update: opts.lastSuccess ?? null,
        last_failed_update: opts.lastFailed ?? null,
      },
    },
  } as unknown as Parameters<typeof statusPatchFromItemGet>[1];
}

describe("plaidErrorCode", () => {
  it("reads error_code from an axios-style Plaid error", () => {
    expect(plaidErrorCode({ response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } } })).toBe(
      "ITEM_LOGIN_REQUIRED",
    );
  });

  it("is null for anything else", () => {
    expect(plaidErrorCode(new Error("boom"))).toBeNull();
    expect(plaidErrorCode(null)).toBeNull();
    expect(plaidErrorCode({ response: { data: "html" } })).toBeNull();
  });
});

describe("statusPatchFromItemGet", () => {
  it("records timestamps and clears a stale error when the Item is healthy", () => {
    const patch = statusPatchFromItemGet(
      "error",
      itemGet({ lastSuccess: "2026-11-15T09:00:00Z", lastFailed: "2026-11-01T00:00:00Z" }),
      NOW,
    );
    expect(patch).toEqual({
      status: "good",
      error_code: null,
      last_successful_update: "2026-11-15T09:00:00Z",
      last_failed_update: "2026-11-01T00:00:00Z",
      consent_expiration_time: null,
      status_checked_at: NOW.toISOString(),
    });
  });

  it("records the Item's error", () => {
    const patch = statusPatchFromItemGet("good", itemGet({ errorCode: "ITEM_LOGIN_REQUIRED" }), NOW);
    expect(patch.status).toBe("error");
    expect(patch.error_code).toBe("ITEM_LOGIN_REQUIRED");
  });

  it("keeps a pending_disconnect warning until a repair clears it", () => {
    const patch = statusPatchFromItemGet(
      "pending_disconnect",
      itemGet({ consentExpires: "2026-11-20T00:00:00Z" }),
      NOW,
    );
    expect(patch.status).toBe("pending_disconnect");
    expect(patch.consent_expiration_time).toBe("2026-11-20T00:00:00Z");
  });

  it("a successful /item/get un-revokes an Item", () => {
    expect(statusPatchFromItemGet("revoked", itemGet({}), NOW).status).toBe("good");
  });

  it("copes with a missing status object", () => {
    const res = { item: { error: null, consent_expiration_time: null } } as unknown as Parameters<
      typeof statusPatchFromItemGet
    >[1];
    const patch = statusPatchFromItemGet("good", res, NOW);
    expect(patch.last_successful_update).toBeNull();
    expect(patch.last_failed_update).toBeNull();
  });
});

describe("statusPatchFromError", () => {
  it("dead access tokens mark the Item revoked", () => {
    expect(statusPatchFromError("ITEM_NOT_FOUND")).toEqual({
      status: "revoked",
      error_code: "ITEM_NOT_FOUND",
    });
  });

  it("anything else is an error with its code", () => {
    expect(statusPatchFromError("INSTITUTION_DOWN")).toEqual({
      status: "error",
      error_code: "INSTITUTION_DOWN",
    });
  });
});

describe("itemConnectionFromRow", () => {
  const row: ItemHealthRow = {
    plaid_item_id: "item-1",
    institution_name: "Chase",
    status: "good",
    error_code: null,
    last_successful_update: "2026-11-12T00:00:00Z",
    last_failed_update: "2026-11-15T06:00:00Z",
    consent_expiration_time: null,
    status_checked_at: "2026-11-15T11:00:00Z",
    created_at: "2026-08-01T00:00:00Z",
  };

  it("derives health from the cached columns", () => {
    expect(itemConnectionFromRow(row, NOW)).toEqual({
      state: "delayed",
      reason: "stale",
      plaidItemId: "item-1",
      institutionName: "Chase",
      lastSuccessfulUpdate: "2026-11-12T00:00:00Z",
    });
  });
});
