import { describe, expect, it } from "vitest";
import {
  amountUsingRemaining,
  linesForCategories,
  linesFromAllocations,
  splitProblem,
  splitRemaining,
  toAllocations,
} from "./split";

const l = (categoryId: string, amountCents: number) => ({ categoryId, amountCents });

describe("splitRemaining", () => {
  it("is what's left of the total, negative when over", () => {
    expect(splitRemaining(8210, [l("a", 5000), l("b", 0)])).toBe(3210);
    expect(splitRemaining(8210, [l("a", 5000), l("b", 4000)])).toBe(-790);
  });
});

describe("amountUsingRemaining", () => {
  it("fills an empty line with what's left", () => {
    expect(amountUsingRemaining(8210, [l("a", 5000), l("b", 0)], 1)).toBe(3210);
  });

  it("tops up a line that already has an amount", () => {
    expect(amountUsingRemaining(8210, [l("a", 5000), l("b", 1000)], 1)).toBe(3210);
  });

  it("trims a line when the split is over", () => {
    expect(amountUsingRemaining(8210, [l("a", 5000), l("b", 4000)], 1)).toBe(3210);
  });

  it("never goes below zero", () => {
    expect(amountUsingRemaining(8210, [l("a", 9000), l("b", 500)], 1)).toBe(0);
  });
});

describe("splitProblem", () => {
  it("needs at least two lines", () => {
    expect(splitProblem(8210, [l("a", 8210)])).toBe("too_few");
  });

  it("needs every line above zero", () => {
    expect(splitProblem(8210, [l("a", 8210), l("b", 0)])).toBe("zero_amount");
  });

  it("must add up exactly", () => {
    expect(splitProblem(8210, [l("a", 5000), l("b", 3000)])).toBe("short");
    expect(splitProblem(8210, [l("a", 5000), l("b", 4000)])).toBe("over");
    expect(splitProblem(8210, [l("a", 5000), l("b", 3210)])).toBeNull();
  });
});

describe("linesForCategories", () => {
  it("keeps amounts for categories still chosen and starts new ones at 0", () => {
    expect(linesForCategories(["b", "c"], [l("a", 100), l("b", 200)])).toEqual([
      l("b", 200),
      l("c", 0),
    ]);
  });
});

describe("toAllocations / linesFromAllocations", () => {
  it("applies the transaction's sign", () => {
    expect(toAllocations([l("a", 5000), l("b", 3210)], -8210)).toEqual([
      { categoryId: "a", amountCents: -5000 },
      { categoryId: "b", amountCents: -3210 },
    ]);
    expect(toAllocations([l("a", 100)], 100)).toEqual([{ categoryId: "a", amountCents: 100 }]);
  });

  it("reads an existing split back as magnitudes", () => {
    expect(linesFromAllocations([{ categoryId: "a", amountCents: -2000 }])).toEqual([l("a", 2000)]);
  });
});
