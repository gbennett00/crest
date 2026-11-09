import { describe, expect, it } from "vitest";
import { groupCategories, splitMatch } from "./category-search";

const cats = [
  { id: "rta", name: "Ready to Assign", groupName: "— Inflows —" },
  { id: "rent", name: "🏡 Rent", groupName: "Bills" },
  { id: "heat", name: "🔥 Heating fuel", groupName: "Bills" },
  { id: "groc", name: "🛒 Groceries", groupName: "Everyday" },
  { id: "gas", name: "⛽ Gas & fuel", groupName: "Transportation" },
];

describe("groupCategories", () => {
  it("keeps every category, grouped in the order given, for an empty query", () => {
    expect(groupCategories(cats, "  ").map(([g, cs]) => [g, cs.map((c) => c.id)])).toEqual([
      ["— Inflows —", ["rta"]],
      ["Bills", ["rent", "heat"]],
      ["Everyday", ["groc"]],
      ["Transportation", ["gas"]],
    ]);
  });

  it("filters by name, case-insensitively, dropping empty groups", () => {
    expect(groupCategories(cats, "FUEL").map(([g, cs]) => [g, cs.map((c) => c.id)])).toEqual([
      ["Bills", ["heat"]],
      ["Transportation", ["gas"]],
    ]);
  });

  it("matches a whole group by its name", () => {
    expect(groupCategories(cats, "bills").map(([g]) => g)).toEqual(["Bills"]);
  });
});

describe("splitMatch", () => {
  it("splits around the first match, keeping the original case", () => {
    expect(splitMatch("Gas & Fuel", "fuel")).toEqual({ before: "Gas & ", match: "Fuel", after: "" });
  });

  it("returns the whole text when nothing matches", () => {
    expect(splitMatch("Rent", "gas")).toEqual({ before: "Rent", match: "", after: "" });
    expect(splitMatch("Rent", "")).toEqual({ before: "Rent", match: "", after: "" });
  });
});
