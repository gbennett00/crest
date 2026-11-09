import { describe, expect, it } from "vitest";
import { keyboardSheetFrame } from "./keyboard-frame";

describe("keyboardSheetFrame", () => {
  it("leaves the sheet alone when no keyboard is open", () => {
    expect(
      keyboardSheetFrame({ layoutHeight: 844, visualHeight: 844, visualOffsetTop: 0 }, true),
    ).toBeNull();
    // A small difference is browser chrome, not a keyboard.
    expect(
      keyboardSheetFrame({ layoutHeight: 844, visualHeight: 790, visualOffsetTop: 0 }, true),
    ).toBeNull();
  });

  it("sits on top of the keyboard and fits the visible height (tall form)", () => {
    // 844px screen, 336px keyboard, visual viewport not scrolled.
    expect(
      keyboardSheetFrame({ layoutHeight: 844, visualHeight: 508, visualOffsetTop: 0 }, true),
    ).toEqual({ bottom: 336, maxHeight: 500, height: 500 });
  });

  it("follows the visual viewport when Safari has scrolled it down", () => {
    // Scrolled 200px to reveal the field: the visible area now ends 136px
    // above the layout viewport's bottom.
    expect(
      keyboardSheetFrame({ layoutHeight: 844, visualHeight: 508, visualOffsetTop: 200 }, false),
    ).toEqual({ bottom: 136, maxHeight: 500 });
  });

  it("never returns a negative bottom", () => {
    expect(
      keyboardSheetFrame({ layoutHeight: 844, visualHeight: 500, visualOffsetTop: 400 }, false),
    ).toEqual({ bottom: 0, maxHeight: 492 });
  });
});
