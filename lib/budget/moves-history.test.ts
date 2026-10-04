import { describe, expect, it } from "vitest";

import { BACKFILL_GROUP_LABEL, buildMoveHistory, type MoveRow } from "./moves-history";

const RENT = { id: "rent", name: "Rent" };
const GROCERIES = { id: "groc", name: "Groceries" };
const RTA = { id: "rta", name: "Ready to Assign" };

function move(overrides: Partial<MoveRow> & Pick<MoveRow, "id" | "movedAt">): MoveRow {
  return {
    month: "2026-09-01",
    amountCents: 1000,
    source: "user",
    from: RTA,
    to: RENT,
    ...overrides,
  };
}

describe("buildMoveHistory", () => {
  it("signs amounts relative to the viewed unit", () => {
    const [group] = buildMoveHistory(
      [
        move({ id: "in", movedAt: "2026-09-25T15:00:00Z", amountCents: 1552 }),
        move({ id: "out", movedAt: "2026-09-25T14:00:00Z", from: RENT, to: GROCERIES, amountCents: 327 }),
      ],
      "rent",
      "UTC",
    );
    expect(group.items.map((i) => [i.id, i.signedCents])).toEqual([
      ["in", 1552],
      ["out", -327],
    ]);
  });

  it("groups by day, newest first", () => {
    const groups = buildMoveHistory(
      [
        move({ id: "a", movedAt: "2026-09-23T10:00:00Z" }),
        move({ id: "b", movedAt: "2026-09-25T10:00:00Z" }),
        move({ id: "c", movedAt: "2026-09-23T18:00:00Z" }),
      ],
      "rent",
      "UTC",
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ["September 25, 2026", ["b"]],
      ["September 23, 2026", ["c", "a"]],
    ]);
  });

  it("uses the viewer's time zone for the day", () => {
    // 02:30 UTC on the 26th is still the evening of the 25th in Denver.
    const [group] = buildMoveHistory(
      [move({ id: "late", movedAt: "2026-09-26T02:30:00Z" })],
      "rent",
      "America/Denver",
    );
    expect(group.label).toBe("September 25, 2026");
  });

  it("puts backfilled moves in a trailing group instead of under a date", () => {
    const groups = buildMoveHistory(
      [
        move({ id: "old", movedAt: "2026-06-01T00:00:00Z", source: "backfill" }),
        move({ id: "new", movedAt: "2026-09-25T10:00:00Z" }),
      ],
      "rent",
      "UTC",
    );
    expect(groups.map((g) => g.label)).toEqual(["September 25, 2026", BACKFILL_GROUP_LABEL]);
    expect(groups[1].items[0].id).toBe("old");
  });

  it("keeps each move's budget month", () => {
    const [group] = buildMoveHistory(
      [move({ id: "jul", movedAt: "2026-10-03T10:00:00Z", month: "2026-07-01" })],
      "rent",
      "UTC",
    );
    expect(group.items[0].month).toBe("2026-07-01");
  });

  it("returns no groups for no moves", () => {
    expect(buildMoveHistory([], "rent", "UTC")).toEqual([]);
  });
});
