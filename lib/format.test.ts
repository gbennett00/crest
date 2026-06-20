import { describe, expect, it } from "vitest";
import { formatCents, parseMoneyExpression } from "./format";

describe("formatCents", () => {
  it("formats positive, zero, and negative cents as USD", () => {
    expect(formatCents(9900)).toBe("$99.00");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-2349)).toBe("-$23.49");
  });
});

describe("parseMoneyExpression", () => {
  it("parses a plain dollar amount into cents", () => {
    expect(parseMoneyExpression("99")).toBe(9900);
    expect(parseMoneyExpression("99.00")).toBe(9900);
    expect(parseMoneyExpression("23.49")).toBe(2349);
  });

  it("parses bare-fraction and trailing-dot amounts", () => {
    expect(parseMoneyExpression(".5")).toBe(50);
    expect(parseMoneyExpression("99.")).toBe(9900);
  });

  it("adds a trailing term to the base value", () => {
    expect(parseMoneyExpression("99.00+23.49")).toBe(12249);
  });

  it("subtracts a trailing term from the base value", () => {
    expect(parseMoneyExpression("99.00-23.49")).toBe(7551);
  });

  it("evaluates a chain of additions and subtractions left to right", () => {
    expect(parseMoneyExpression("100-5+2.50")).toBe(9750);
  });

  it("can produce a negative result when subtracting more than the base", () => {
    expect(parseMoneyExpression("99-150")).toBe(-5100);
  });

  it("honors a leading sign", () => {
    expect(parseMoneyExpression("+23.49")).toBe(2349);
    expect(parseMoneyExpression("-23.49")).toBe(-2349);
  });

  it("ignores currency symbols, separators, and whitespace", () => {
    expect(parseMoneyExpression(" $1,234.50 ")).toBe(123450);
    expect(parseMoneyExpression("99.00 + 23.49")).toBe(12249);
  });

  it("rounds each term independently to avoid float drift", () => {
    expect(parseMoneyExpression("0.1+0.2")).toBe(30);
  });

  it("returns null for empty input", () => {
    expect(parseMoneyExpression("")).toBeNull();
    expect(parseMoneyExpression("   ")).toBeNull();
  });

  it("returns null for invalid expressions", () => {
    expect(parseMoneyExpression("abc")).toBeNull();
    expect(parseMoneyExpression("99*2")).toBeNull();
    expect(parseMoneyExpression("99+")).toBeNull();
    expect(parseMoneyExpression("99++23")).toBeNull();
    expect(parseMoneyExpression("9.9.9")).toBeNull();
  });
});
