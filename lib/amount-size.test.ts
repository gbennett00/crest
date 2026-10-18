import { describe, expect, it } from "vitest";
import { amountFontSize } from "./amount-size";

describe("amountFontSize", () => {
  it("keeps the base size for figures that fit the column", () => {
    expect(amountFontSize("$0.00", 14)).toBe(14);
    expect(amountFontSize("-$100.27", 14)).toBe(14);
    expect(amountFontSize("$1,500.00", 14)).toBe(14);
  });

  it("steps down 1px per extra character", () => {
    expect(amountFontSize("$10,000.00", 14)).toBe(13);
    expect(amountFontSize("-$10,000.00", 14)).toBe(12);
    expect(amountFontSize("$100,000.00", 14)).toBe(12);
  });

  it("never goes below the floor", () => {
    expect(amountFontSize("$10,000,000.00", 14)).toBe(10);
    expect(amountFontSize("-$1,000,000,000.00", 13)).toBe(10);
  });

  it("starts smaller for a smaller base (pills)", () => {
    expect(amountFontSize("$1,500.00", 13)).toBe(13);
    expect(amountFontSize("$29,444.29", 13)).toBe(12);
  });

  it("leaves the masked privacy figure alone", () => {
    expect(amountFontSize("$XX.XX", 14)).toBe(14);
  });
});
