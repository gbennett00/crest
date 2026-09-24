import { describe, expect, it } from "vitest";
import { formatCents } from "./format";

describe("formatCents", () => {
  it("formats positive, zero, and negative cents as USD", () => {
    expect(formatCents(9900)).toBe("$99.00");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-2349)).toBe("-$23.49");
  });
});
