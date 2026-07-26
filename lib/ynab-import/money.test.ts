import { describe, expect, it } from "vitest";

import { parseDollarsToCents, parseMonthYear, parseUsDate } from "./money";

describe("parseDollarsToCents", () => {
  it("parses a plain amount", () => {
    expect(parseDollarsToCents("$4.50")).toBe(450);
  });

  it("parses comma thousands separators", () => {
    expect(parseDollarsToCents("$1,450.00")).toBe(145000);
  });

  it("parses negative amounts (minus before the dollar sign)", () => {
    expect(parseDollarsToCents("-$7.41")).toBe(-741);
  });

  it("parses zero", () => {
    expect(parseDollarsToCents("$0.00")).toBe(0);
  });

  it("treats an empty string as zero", () => {
    expect(parseDollarsToCents("")).toBe(0);
  });
});

describe("parseUsDate", () => {
  it("converts MM/DD/YYYY to YYYY-MM-DD", () => {
    expect(parseUsDate("07/03/2026")).toBe("2026-07-03");
  });
});

describe("parseMonthYear", () => {
  it("converts 'Mon YYYY' to the first of that month", () => {
    expect(parseMonthYear("Jan 2026")).toBe("2026-01-01");
    expect(parseMonthYear("Dec 2026")).toBe("2026-12-01");
  });
});
