import { describe, expect, it } from "vitest";
import { formatCellValue, formatCost, resultColumns } from "./format";

describe("resultColumns", () => {
  it("keeps the query's column order and picks up keys missing from the first row", () => {
    expect(resultColumns([{ b: 1, a: 2 }, { b: 3, a: 4, c: 5 }])).toEqual(["b", "a", "c"]);
  });
});

describe("formatCellValue", () => {
  it("renders nulls, objects and scalars", () => {
    expect(formatCellValue(null)).toBe("NULL");
    expect(formatCellValue({ x: 1 })).toBe('{"x":1}');
    expect(formatCellValue(-4200)).toBe("-4200");
    expect(formatCellValue(false)).toBe("false");
  });
});

describe("formatCost", () => {
  it("shows fractions of a cent", () => {
    expect(formatCost(0.0018)).toBe("0.18¢");
    expect(formatCost(0.00001)).toBe("<0.01¢");
    expect(formatCost(1.5)).toBe("$1.50");
  });
});
