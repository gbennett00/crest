import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({ createPlaidClient: vi.fn() }));
vi.mock("./sync", () => ({ syncItem: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushToPlan: vi.fn() }));

import {
  itemConnectionFromRow,
  itemErrorCode,
  plaidErrorCode,
  shouldNotifyNeedsRepair,
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
  noStatus?: boolean;
}) {
  return {
    item: {
      error: opts.errorCode ? { error_code: opts.errorCode } : null,
      consent_expiration_time: opts.consentExpires ?? null,
    },
    status: opts.noStatus
      ? null
      : {
          transactions: {
            last_successful_update: opts.lastSuccess ?? null,
            last_failed_update: opts.lastFailed ?? null,
          },
        },
  } as unknown as Parameters<typeof statusPatchFromItemGet>[0];
}

const plaidError = (error_type: string, error_code: string) => ({
  response: { data: { error_type, error_code } },
});

describe("plaidErrorCode", () => {
  it("reads error_code from an axios-style Plaid error", () => {
    expect(plaidErrorCode(plaidError("ITEM_ERROR", "ITEM_LOGIN_REQUIRED"))).toBe(
      "ITEM_LOGIN_REQUIRED",
    );
  });

  it("is null for anything else", () => {
    expect(plaidErrorCode(new Error("boom"))).toBeNull();
    expect(plaidErrorCode(null)).toBeNull();
    expect(plaidErrorCode({ response: { data: "html" } })).toBeNull();
  });
});

describe("itemErrorCode", () => {
  it("keeps Item and institution errors", () => {
    expect(itemErrorCode(plaidError("ITEM_ERROR", "ITEM_LOGIN_REQUIRED"))).toBe(
      "ITEM_LOGIN_REQUIRED",
    );
    expect(itemErrorCode(plaidError("INSTITUTION_ERROR", "INSTITUTION_DOWN"))).toBe(
      "INSTITUTION_DOWN",
    );
  });

  it("keeps a dead access token even though Plaid calls it invalid input", () => {
    expect(itemErrorCode(plaidError("INVALID_INPUT", "INVALID_ACCESS_TOKEN"))).toBe(
      "INVALID_ACCESS_TOKEN",
    );
  });

  it("ignores failures that say nothing about the connection", () => {
    expect(itemErrorCode(plaidError("INVALID_REQUEST", "INVALID_FIELD"))).toBeNull();
    expect(itemErrorCode(plaidError("API_ERROR", "INTERNAL_SERVER_ERROR"))).toBeNull();
    expect(itemErrorCode(plaidError("RATE_LIMIT_EXCEEDED", "RATE_LIMIT"))).toBeNull();
    expect(itemErrorCode(new Error("network"))).toBeNull();
  });
});

describe("statusPatchFromItemGet", () => {
  it("records timestamps and clears a stale error when the Item is healthy", () => {
    const patch = statusPatchFromItemGet(
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
    const patch = statusPatchFromItemGet(itemGet({ errorCode: "ITEM_LOGIN_REQUIRED" }), NOW);
    expect(patch.status).toBe("error");
    expect(patch.error_code).toBe("ITEM_LOGIN_REQUIRED");
  });

  it("a successful /item/get un-revokes an Item", () => {
    expect(statusPatchFromItemGet(itemGet({}), NOW).status).toBe("good");
  });

  it("keeps the stored timestamps when Plaid omits them", () => {
    for (const res of [itemGet({ noStatus: true }), itemGet({})]) {
      const patch = statusPatchFromItemGet(res, NOW);
      expect(patch).not.toHaveProperty("last_successful_update");
      expect(patch).not.toHaveProperty("last_failed_update");
    }
  });

  it("clears a disconnect warning once consent runs well past the window", () => {
    const renewed = statusPatchFromItemGet(itemGet({ consentExpires: "2027-11-15T00:00:00Z" }), NOW);
    expect(renewed.disconnect_warned_at).toBeNull();
  });

  it("leaves the warning alone when consent is still close or unknown", () => {
    const soon = statusPatchFromItemGet(itemGet({ consentExpires: "2026-11-20T00:00:00Z" }), NOW);
    expect(soon).not.toHaveProperty("disconnect_warned_at");
    expect(statusPatchFromItemGet(itemGet({}), NOW)).not.toHaveProperty("disconnect_warned_at");
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

const healthyRow: ItemHealthRow = {
  plaid_item_id: "item-1",
  institution_name: "Chase",
  status: "good",
  error_code: null,
  last_successful_update: "2026-11-15T09:00:00Z",
  last_failed_update: null,
  consent_expiration_time: null,
  disconnect_warned_at: null,
  status_checked_at: "2026-11-15T11:00:00Z",
  created_at: "2026-08-01T00:00:00Z",
};

describe("shouldNotifyNeedsRepair", () => {
  const loginRequired = { ...healthyRow, status: "error", error_code: "ITEM_LOGIN_REQUIRED" };

  it("notifies on the transition into needs repair", () => {
    expect(shouldNotifyNeedsRepair(healthyRow, loginRequired, NOW)).toBe(true);
  });

  it("doesn't repeat for an Item that already needed repair", () => {
    expect(shouldNotifyNeedsRepair(loginRequired, loginRequired, NOW)).toBe(false);
    // Expiry already reported by the daily check, then the webhook arrives.
    const expiring = { ...healthyRow, consent_expiration_time: "2026-11-18T00:00:00Z" };
    expect(
      shouldNotifyNeedsRepair(
        expiring,
        { ...expiring, disconnect_warned_at: NOW.toISOString() },
        NOW,
      ),
    ).toBe(false);
  });

  it("never notifies for a delay", () => {
    expect(
      shouldNotifyNeedsRepair(
        healthyRow,
        { ...healthyRow, status: "error", error_code: "INSTITUTION_DOWN" },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("itemConnectionFromRow", () => {
  it("derives health from the cached columns", () => {
    const row = {
      ...healthyRow,
      last_successful_update: "2026-11-12T00:00:00Z",
      last_failed_update: "2026-11-15T06:00:00Z",
    };
    expect(itemConnectionFromRow(row, NOW)).toEqual({
      state: "delayed",
      reason: "stale",
      plaidItemId: "item-1",
      institutionName: "Chase",
      lastSuccessfulUpdate: "2026-11-12T00:00:00Z",
    });
  });
});
