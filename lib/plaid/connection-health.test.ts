import { describe, expect, it } from "vitest";

import { deriveConnectionHealth, type ConnectionHealthInput } from "./connection-health";

const NOW = new Date("2026-11-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();

function input(overrides: Partial<ConnectionHealthInput> = {}): ConnectionHealthInput {
  return {
    status: "good",
    errorCode: null,
    lastSuccessfulUpdate: hoursAgo(3),
    lastFailedUpdate: null,
    consentExpirationTime: null,
    statusCheckedAt: hoursAgo(1),
    createdAt: hoursAgo(24 * 90),
    ...overrides,
  };
}

const health = (o: Partial<ConnectionHealthInput> = {}) => deriveConnectionHealth(input(o), NOW);

describe("deriveConnectionHealth", () => {
  it("is ok when Plaid checked the bank recently, even if nothing new came in", () => {
    // The quiet-account case: last_successful_update moves on every successful
    // check whether or not there was new data.
    expect(health()).toEqual({ state: "ok", reason: null });
  });

  describe("needs repair", () => {
    it("ITEM_LOGIN_REQUIRED", () => {
      expect(health({ status: "error", errorCode: "ITEM_LOGIN_REQUIRED" })).toEqual({
        state: "needs_repair",
        reason: "login_required",
      });
    });

    it("wins over a fresh last_successful_update", () => {
      expect(
        health({ errorCode: "ITEM_LOGIN_REQUIRED", lastSuccessfulUpdate: hoursAgo(0) }).state,
      ).toBe("needs_repair");
    });

    it("bank-side lockouts ask the user to visit the bank", () => {
      for (const code of ["ITEM_LOCKED", "PASSWORD_RESET_REQUIRED", "USER_SETUP_REQUIRED"]) {
        expect(health({ status: "error", errorCode: code })).toEqual({
          state: "needs_repair",
          reason: "bank_action_required",
        });
      }
    });

    it("revoked status or a dead access token", () => {
      expect(health({ status: "revoked" }).reason).toBe("revoked");
      expect(health({ status: "revoked", errorCode: "ITEM_NOT_FOUND" }).reason).toBe("revoked");
      expect(health({ status: "error", errorCode: "INVALID_ACCESS_TOKEN" }).reason).toBe(
        "revoked",
      );
    });

    it("an unknown error code defaults to update mode", () => {
      expect(health({ status: "error", errorCode: "SOMETHING_NEW" })).toEqual({
        state: "needs_repair",
        reason: "login_required",
      });
    });

    it("an error status with no code", () => {
      expect(health({ status: "error" }).reason).toBe("login_required");
    });

    it("PENDING_DISCONNECT / PENDING_EXPIRATION webhook", () => {
      expect(health({ status: "pending_disconnect" })).toEqual({
        state: "needs_repair",
        reason: "expiring",
      });
    });

    it("consent expiring within 7 days, even without the webhook", () => {
      expect(health({ consentExpirationTime: hoursAhead(24 * 6) }).reason).toBe("expiring");
      expect(health({ consentExpirationTime: hoursAgo(1) }).reason).toBe("expiring");
      expect(health({ consentExpirationTime: hoursAhead(24 * 8) }).state).toBe("ok");
    });

    it("a login error outranks an expiring consent", () => {
      expect(
        health({
          status: "error",
          errorCode: "ITEM_LOGIN_REQUIRED",
          consentExpirationTime: hoursAhead(1),
        }).reason,
      ).toBe("login_required");
    });
  });

  describe("delayed", () => {
    it("institution outages are delayed, not repairable", () => {
      for (const code of ["INSTITUTION_DOWN", "INSTITUTION_NOT_RESPONDING", "PRODUCT_NOT_READY"]) {
        expect(health({ status: "error", errorCode: code })).toEqual({
          state: "delayed",
          reason: "institution_issue",
        });
      }
    });

    it("no successful check for 48h", () => {
      expect(health({ lastSuccessfulUpdate: hoursAgo(48) })).toEqual({
        state: "delayed",
        reason: "stale",
      });
      expect(health({ lastSuccessfulUpdate: hoursAgo(47) }).state).toBe("ok");
    });

    it("24h without success and failing since", () => {
      expect(
        health({ lastSuccessfulUpdate: hoursAgo(30), lastFailedUpdate: hoursAgo(2) }).state,
      ).toBe("delayed");
    });

    it("a recent failure alone is not reported (Plaid retries several times a day)", () => {
      expect(
        health({ lastSuccessfulUpdate: hoursAgo(10), lastFailedUpdate: hoursAgo(1) }).state,
      ).toBe("ok");
    });

    it("an old failure followed by success is fine", () => {
      expect(
        health({ lastSuccessfulUpdate: hoursAgo(30), lastFailedUpdate: hoursAgo(40) }).state,
      ).toBe("ok");
    });
  });

  describe("missing data", () => {
    it("never checked → ok, whatever the timestamps say", () => {
      expect(
        health({ statusCheckedAt: null, lastSuccessfulUpdate: null }),
      ).toEqual({ state: "ok", reason: null });
    });

    it("a just-linked Item with no successful update yet is ok", () => {
      expect(
        health({ lastSuccessfulUpdate: null, createdAt: hoursAgo(2) }).state,
      ).toBe("ok");
    });

    it("an Item that has never had a successful update for days is delayed", () => {
      expect(
        health({ lastSuccessfulUpdate: null, createdAt: hoursAgo(72) }),
      ).toEqual({ state: "delayed", reason: "stale" });
    });
  });
});
