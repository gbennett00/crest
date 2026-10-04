import { describe, expect, it } from "vitest";
import {
  type AssignmentKey,
  initialAssignmentEditState,
  pressAssignmentKey,
  resolveAssignmentEditState,
  setAssignmentCents,
  centsFromDigits,
  formatCentsInput,
  MAX_MAGNITUDE_CENTS,
  resolveAssignmentCommit,
} from "./currency-input";

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

describe("resolveAssignmentCommit", () => {
  it("returns null when nothing was typed, leaving the original value alone", () => {
    expect(
      resolveAssignmentCommit({
        touched: false,
        mode: "absolute",
        original: 15000,
        absoluteCents: 0,
        deltaSign: 1,
        deltaCents: 0,
      }),
    ).toBeNull();
  });

  it("commits the freshly typed absolute value, ignoring the original", () => {
    expect(
      resolveAssignmentCommit({
        touched: true,
        mode: "absolute",
        original: 15000,
        absoluteCents: 2500,
        deltaSign: 1,
        deltaCents: 0,
      }),
    ).toBe(2500);
  });

  it("adds a positive delta to the original", () => {
    expect(
      resolveAssignmentCommit({
        touched: true,
        mode: "delta",
        original: 15000,
        absoluteCents: 0,
        deltaSign: 1,
        deltaCents: 500,
      }),
    ).toBe(15500);
  });

  it("subtracts a negative delta from the original", () => {
    expect(
      resolveAssignmentCommit({
        touched: true,
        mode: "delta",
        original: 15000,
        absoluteCents: 0,
        deltaSign: -1,
        deltaCents: 500,
      }),
    ).toBe(14500);
  });

  it("can push the result negative when subtracting more than the original", () => {
    expect(
      resolveAssignmentCommit({
        touched: true,
        mode: "delta",
        original: 500,
        absoluteCents: 0,
        deltaSign: -1,
        deltaCents: 1500,
      }),
    ).toBe(-1000);
  });

  it("commits the unchanged original when +/- was pressed but no delta digits were typed", () => {
    expect(
      resolveAssignmentCommit({
        touched: true,
        mode: "delta",
        original: 15000,
        absoluteCents: 0,
        deltaSign: 1,
        deltaCents: 0,
      }),
    ).toBe(15000);
  });
});

describe("assignment keypad", () => {
  function press(original: number, keys: AssignmentKey[]) {
    const state = keys.reduce(pressAssignmentKey, initialAssignmentEditState(original));
    return resolveAssignmentEditState(state);
  }

  it("commits nothing until a key is pressed", () => {
    expect(press(15000, [])).toBeNull();
  });

  it("shifts digits in from the right on top of the prefilled value", () => {
    expect(press(0, ["1", "2", "3"])).toBe(123);
    expect(press(500, ["2"])).toBe(5002);
  });

  it("backspace and clear edit the active field", () => {
    expect(press(0, ["1", "2", "3", "backspace"])).toBe(12);
    expect(press(15000, ["clear"])).toBe(0);
  });

  it("types a negative amount from zero with the minus key", () => {
    expect(press(0, ["-", "4", "8", "0", "0"])).toBe(-4800);
  });

  it("applies +/- as a delta on a non-zero original", () => {
    expect(press(10000, ["-", "1", "4", "8", "0", "0"])).toBe(-4800);
    expect(press(10000, ["+", "5", "0", "0"])).toBe(10500);
  });

  it("keeps a freshly typed amount as the base when +/- is pressed", () => {
    // Typing 10.00 into a $0 cell and then "+" must not drop the 10.00.
    expect(press(0, ["1", "0", "0", "0", "+", "5", "0", "0"])).toBe(1500);
    expect(press(0, ["1", "0", "0", "0", "-", "5", "0", "0"])).toBe(500);
    expect(press(10000, ["clear", "5", "0", "0", "0", "+", "1", "0", "0"])).toBe(5100);
  });

  it("re-signs the delta when the other operator is pressed", () => {
    expect(press(10000, ["-", "5", "0", "0", "+"])).toBe(10500);
  });

  it("= folds the delta in and keeps chaining from the result", () => {
    expect(press(10000, ["+", "5", "0", "0", "="])).toBe(10500);
    expect(press(10000, ["+", "5", "0", "0", "=", "-", "2", "0", "0"])).toBe(10300);
  });

  it("= can land on a negative amount and keep editing it as an absolute", () => {
    const state = (["-", "1", "5", "0", "0", "0", "="] as AssignmentKey[]).reduce(
      pressAssignmentKey,
      initialAssignmentEditState(10000),
    );
    expect(state).toMatchObject({ mode: "absolute", absoluteSign: -1, absoluteCents: 5000 });
    expect(resolveAssignmentEditState(pressAssignmentKey(state, "1"))).toBe(-50001);
  });

  it("clamps to the maximum magnitude", () => {
    const keys = Array(15).fill("9") as AssignmentKey[];
    expect(press(0, keys)).toBe(MAX_MAGNITUDE_CENTS);
  });

  it("applies native-input values to the active field, keeping a pending sign at zero", () => {
    const negative = pressAssignmentKey(initialAssignmentEditState(-100), "backspace");
    expect(setAssignmentCents(negative, 0).absoluteSign).toBe(-1);
    const delta = pressAssignmentKey(initialAssignmentEditState(100), "-");
    expect(resolveAssignmentEditState(setAssignmentCents(delta, 30))).toBe(70);
  });
});
