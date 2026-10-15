import { describe, expect, it } from "vitest";
import { availablePillState } from "./available-pill";

describe("availablePillState", () => {
  it("is neg below zero, zero at exactly zero, pos above", () => {
    expect(availablePillState(-1)).toBe("neg");
    expect(availablePillState(0)).toBe("zero");
    expect(availablePillState(12_940)).toBe("pos");
  });

  it("turns a funded balance into a warning when underfunded", () => {
    expect(availablePillState(900, { underfunded: true })).toBe("warn");
  });

  it("never lets underfunded override overspent or zero", () => {
    expect(availablePillState(-1_431, { underfunded: true })).toBe("neg");
    expect(availablePillState(0, { underfunded: true })).toBe("zero");
  });
});
