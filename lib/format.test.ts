import { describe, expect, it } from "vitest";
import { formatCents, formatDate } from "./format";

describe("formatCents", () => {
  it("formats positive, zero, and negative cents as USD", () => {
    expect(formatCents(9900)).toBe("$99.00");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-2349)).toBe("-$23.49");
  });
});

describe("formatDate", () => {
  it("formats an ISO timestamp as a short date", () => {
    expect(formatDate("2026-10-12T12:00:00Z")).toBe("Oct 12, 2026");
  });

  it("returns an empty string for missing or invalid input", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });
});
