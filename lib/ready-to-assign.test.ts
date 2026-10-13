import { describe, expect, it } from "vitest";
import { readyToAssignState } from "./ready-to-assign";

describe("readyToAssignState", () => {
  it("is assign when there is money to assign", () => {
    expect(readyToAssignState(185_422)).toBe("assign");
  });
  it("is done at exactly zero", () => {
    expect(readyToAssignState(0)).toBe("done");
  });
  it("is over when negative", () => {
    expect(readyToAssignState(-12_000)).toBe("over");
  });
});
