import { describe, expect, it } from "vitest";
import { keyboardFrame, sameFrame } from "./keyboard-frame";

const m = (visualHeight: number, visualOffsetTop = 0, scale = 1) => ({
  layoutHeight: 844,
  visualHeight,
  visualOffsetTop,
  scale,
});

describe("keyboardFrame", () => {
  it("leaves the sheet alone when no keyboard is open", () => {
    expect(keyboardFrame(m(844))).toBeNull();
    // A small difference is browser chrome, not a keyboard.
    expect(keyboardFrame(m(790))).toBeNull();
  });

  it("sits on top of the keyboard and caps to the visible height", () => {
    // 336px keyboard, visual viewport not scrolled.
    expect(keyboardFrame(m(508))).toEqual({ bottom: 336, maxHeight: 500 });
  });

  it("follows the visual viewport when Safari has scrolled it down", () => {
    expect(keyboardFrame(m(508, 200))).toEqual({ bottom: 136, maxHeight: 500 });
  });

  it("never returns a negative bottom", () => {
    expect(keyboardFrame(m(500, 400))).toEqual({ bottom: 0, maxHeight: 492 });
  });

  it("ignores pinch-zoom, which also shrinks the visual viewport", () => {
    expect(keyboardFrame(m(422, 100, 2))).toBeNull();
  });
});

describe("sameFrame", () => {
  it("compares by value", () => {
    expect(sameFrame({ bottom: 1, maxHeight: 2 }, { bottom: 1, maxHeight: 2 })).toBe(true);
    expect(sameFrame({ bottom: 1, maxHeight: 2 }, { bottom: 1, maxHeight: 3 })).toBe(false);
    expect(sameFrame(null, null)).toBe(true);
    expect(sameFrame(null, { bottom: 0, maxHeight: 0 })).toBe(false);
  });
});
