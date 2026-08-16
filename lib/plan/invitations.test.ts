import { describe, expect, it } from "vitest";

import {
  INVITATION_TTL_DAYS,
  generateInvitationToken,
  isInvitationExpired,
  isValidEmail,
  normalizeEmail,
} from "./invitations";

describe("generateInvitationToken", () => {
  it("produces a URL-safe token without padding", () => {
    const token = generateInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces distinct tokens", () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => generateInvitationToken()),
    );
    expect(tokens.size).toBe(100);
  });
});

describe("isInvitationExpired", () => {
  const now = new Date("2026-08-16T12:00:00Z");

  it("is false before the expiry instant", () => {
    const future = new Date("2026-08-20T12:00:00Z");
    expect(isInvitationExpired(future, now)).toBe(false);
  });

  it("is true once the expiry instant has passed", () => {
    const past = new Date("2026-08-01T12:00:00Z");
    expect(isInvitationExpired(past, now)).toBe(true);
  });

  it("treats the exact expiry instant as expired", () => {
    expect(isInvitationExpired(now, now)).toBe(true);
  });

  it("accepts ISO strings", () => {
    expect(isInvitationExpired("2026-08-20T12:00:00Z", now)).toBe(false);
    expect(isInvitationExpired("2026-08-01T12:00:00Z", now)).toBe(true);
  });

  it("matches a one-week TTL boundary", () => {
    const created = new Date("2026-08-16T12:00:00Z");
    const expiresAt = new Date(
      created.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const justBefore = new Date(expiresAt.getTime() - 1000);
    const justAfter = new Date(expiresAt.getTime() + 1000);
    expect(isInvitationExpired(expiresAt, justBefore)).toBe(false);
    expect(isInvitationExpired(expiresAt, justAfter)).toBe(true);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Person@Example.COM ")).toBe("person@example.com");
  });
});

describe("isValidEmail", () => {
  it("accepts plausible addresses", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("first.last@sub.example.com")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("missing@domain")).toBe(false);
    expect(isValidEmail("spaces in@email.com")).toBe(false);
  });
});
