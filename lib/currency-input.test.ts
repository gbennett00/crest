import { describe, expect, it } from "vitest";
import { centsFromDigits, formatCentsInput, MAX_MAGNITUDE_CENTS } from "./currency-input";

describe("centsFromDigits", () => {
  it("shifts a digit in as the new rightmost cent, like typing one key at a time", () => {
    // Typing 1, 2, 3, 0, 0 into an empty field should land on $123.00,
    // passing through $0.01, $0.12, $1.23, $12.30 along the way — each
    // keystroke re-renders the field with the previous step's digits plus
    // the new one appended at the end.
    expect(centsFromDigits("1", 1)).toBe(1);
    expect(centsFromDigits("12", 1)).toBe(12);
    expect(centsFromDigits("123", 1)).toBe(123);
    expect(centsFromDigits("1230", 1)).toBe(1230);
    expect(centsFromDigits("12300", 1)).toBe(12300);
  });

  it("shifts the rightmost digit out on backspace, taking exactly one press per digit", () => {
    // $100.00 is 10000 cents (5 digits) — clearing it takes 5 backspaces.
    expect(centsFromDigits("1000", 1)).toBe(1000); // "10000" -> "1000"
    expect(centsFromDigits("100", 1)).toBe(100); // -> "100"
    expect(centsFromDigits("10", 1)).toBe(10); // -> "10"
    expect(centsFromDigits("1", 1)).toBe(1); // -> "1"
    expect(centsFromDigits("", 1)).toBe(0); // -> ""
  });

  it("ignores the decimal point and currency symbols in the displayed value", () => {
    expect(centsFromDigits("1.23", 1)).toBe(123);
    expect(centsFromDigits("$1,234.56", 1)).toBe(123456);
  });

  it("applies the given sign to a non-zero magnitude", () => {
    expect(centsFromDigits("500", -1)).toBe(-500);
    expect(centsFromDigits("", -1)).toBe(0);
    expect(centsFromDigits("0", -1)).toBe(0);
  });

  it("clamps to the maximum magnitude instead of overflowing", () => {
    expect(centsFromDigits("9999999999999999", 1)).toBe(MAX_MAGNITUDE_CENTS);
  });
});

describe("formatCentsInput", () => {
  it("formats cents as a plain two-decimal string without a currency symbol", () => {
    expect(formatCentsInput(12300)).toBe("123.00");
    expect(formatCentsInput(0)).toBe("0.00");
    expect(formatCentsInput(-500)).toBe("-5.00");
    expect(formatCentsInput(1)).toBe("0.01");
  });
});
