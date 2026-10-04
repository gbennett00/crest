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

  it("orders backfilled moves by budget month, newest first, not by when they were saved", () => {
    // Saved out of month order, as an import or old edits leave them.
    const groups = buildMoveHistory(
      [
        move({ id: "feb", movedAt: "2026-09-01T10:00:05Z", month: "2026-02-01", source: "backfill" }),
        move({ id: "oct", movedAt: "2026-09-01T10:00:01Z", month: "2026-10-01", source: "backfill" }),
        move({ id: "apr", movedAt: "2026-09-01T10:00:09Z", month: "2026-04-01", source: "backfill" }),
        move({ id: "mar", movedAt: "2026-09-01T10:00:02Z", month: "2026-03-01", source: "backfill" }),
      ],
      "rent",
      "UTC",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(["oct", "apr", "mar", "feb"]);
  });

  it("compares instants, not timestamp strings", () => {
    // Same instant ordering regardless of offset formatting.
    const [group] = buildMoveHistory(
      [
        move({ id: "earlier", movedAt: "2026-09-25T12:00:00-06:00" }), // 18:00Z
        move({ id: "later", movedAt: "2026-09-25T19:00:00+00:00" }),
      ],
      "rent",
      "UTC",
    );
    expect(group.items.map((i) => i.id)).toEqual(["later", "earlier"]);
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
