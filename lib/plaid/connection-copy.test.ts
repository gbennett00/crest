import { describe, expect, it } from "vitest";

import { connectionCopy, formatSince } from "./connection-copy";
import type { ItemConnection } from "./connection-health";

const NOW = new Date("2026-11-15T12:00:00Z");

function conn(o: Partial<ItemConnection>): ItemConnection {
  return {
    state: "ok",
    reason: null,
    plaidItemId: "item-1",
    institutionName: "Chase",
    lastSuccessfulUpdate: null,
    ...o,
  };
}

describe("formatSince", () => {
  it("formats hours, then days", () => {
    expect(formatSince("2026-11-15T11:30:00Z", NOW)).toBe("just now");
    expect(formatSince("2026-11-15T07:00:00Z", NOW)).toBe("5 hours ago");
    expect(formatSince("2026-11-12T12:00:00Z", NOW)).toBe("3 days ago");
  });
});

describe("connectionCopy", () => {
  it("says nothing for a healthy connection", () => {
    expect(connectionCopy(conn({}), NOW)).toBeNull();
  });

  it("offers reconnect for every needs-repair reason", () => {
    for (const reason of ["login_required", "expiring", "bank_action_required", "revoked"] as const) {
      const copy = connectionCopy(conn({ state: "needs_repair", reason }), NOW);
      expect(copy?.label).toBe("Needs repair");
      expect(copy?.canReconnect).toBe(true);
    }
  });

  it("tells the user a delay needs no action, with the last update time", () => {
    const copy = connectionCopy(
      conn({ state: "delayed", reason: "stale", lastSuccessfulUpdate: "2026-11-12T12:00:00Z" }),
      NOW,
    );
    expect(copy?.label).toBe("Delayed");
    expect(copy?.canReconnect).toBe(false);
    expect(copy?.body).toContain("Chase");
    expect(copy?.body).toContain("3 days ago");
  });

  it("falls back to a generic bank name", () => {
    const copy = connectionCopy(
      conn({ state: "needs_repair", reason: "login_required", institutionName: null }),
      NOW,
    );
    expect(copy?.body).toContain("your bank");
  });
});
