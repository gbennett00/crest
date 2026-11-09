import { describe, expect, it } from "vitest";
import {
  planBulkApproval,
  rankPayeeCategories,
  suggestionWindowStart,
  suggestionsFor,
} from "./approval";

const valid = new Set(["groc", "home", "dine", "gas", "health"]);

describe("rankPayeeCategories", () => {
  it("orders a payee's categories by how often they were used", () => {
    const ranked = rankPayeeCategories(
      [
        { payeeKey: "smiths", txnDate: "2026-10-01", categoryIds: ["home"] },
        { payeeKey: "smiths", txnDate: "2026-10-02", categoryIds: ["groc"] },
        { payeeKey: "smiths", txnDate: "2026-10-03", categoryIds: ["groc"] },
        { payeeKey: "maverik", txnDate: "2026-10-03", categoryIds: ["gas"] },
      ],
      valid,
    );
    expect(ranked.get("smiths")).toEqual(["groc", "home"]);
    expect(ranked.get("maverik")).toEqual(["gas"]);
  });

  it("breaks ties by most recent use", () => {
    const ranked = rankPayeeCategories(
      [
        { payeeKey: "p", txnDate: "2026-09-01", categoryIds: ["home"] },
        { payeeKey: "p", txnDate: "2026-10-01", categoryIds: ["dine"] },
      ],
      valid,
    );
    expect(ranked.get("p")).toEqual(["dine", "home"]);
  });

  it("counts a split once per distinct category", () => {
    const ranked = rankPayeeCategories(
      [
        { payeeKey: "p", txnDate: "2026-10-01", categoryIds: ["home", "home", "groc"] },
        { payeeKey: "p", txnDate: "2026-09-01", categoryIds: ["groc"] },
      ],
      valid,
    );
    expect(ranked.get("p")).toEqual(["groc", "home"]);
  });

  it("drops categories that are no longer offered", () => {
    const ranked = rankPayeeCategories(
      [
        { payeeKey: "p", txnDate: "2026-10-01", categoryIds: ["archived"] },
        { payeeKey: "q", txnDate: "2026-10-01", categoryIds: ["archived", "gas"] },
      ],
      valid,
    );
    expect(ranked.has("p")).toBe(false);
    expect(ranked.get("q")).toEqual(["gas"]);
  });
});

describe("suggestionsFor", () => {
  it("caps the ranked list at four", () => {
    expect(suggestionsFor(null, ["a", "b", "c", "d", "e"])).toEqual(["a", "b", "c", "d"]);
  });

  it("puts the row's current category first without duplicating it", () => {
    expect(suggestionsFor("c", ["a", "b", "c", "d"])).toEqual(["c", "a", "b", "d"]);
  });

  it("keeps a current category the payee history never used", () => {
    expect(suggestionsFor("z", ["a", "b", "c", "d"])).toEqual(["z", "a", "b", "c"]);
  });

  it("returns nothing for a new payee with no category", () => {
    expect(suggestionsFor(null, undefined)).toEqual([]);
  });
});

describe("planBulkApproval", () => {
  it("approves as-is when every row has a category, even different ones", () => {
    expect(
      planBulkApproval([
        { categoryId: "groc", categorized: true },
        { categoryId: "gas", categorized: true },
        { categoryId: null, categorized: true }, // split
      ]),
    ).toEqual({ kind: "as-is" });
  });

  it("prefills when every categorized row shares one category", () => {
    expect(
      planBulkApproval([
        { categoryId: "groc", categorized: true },
        { categoryId: "groc", categorized: true },
        { categoryId: null, categorized: false },
      ]),
    ).toEqual({ kind: "choose", prefillCategoryId: "groc" });
  });

  it("leaves the choice empty when categories differ", () => {
    expect(
      planBulkApproval([
        { categoryId: "groc", categorized: true },
        { categoryId: "gas", categorized: true },
        { categoryId: null, categorized: false },
      ]),
    ).toEqual({ kind: "choose", prefillCategoryId: null });
  });

  it("does not prefill from a split row", () => {
    expect(
      planBulkApproval([
        { categoryId: null, categorized: true },
        { categoryId: null, categorized: false },
      ]),
    ).toEqual({ kind: "choose", prefillCategoryId: null });
  });

  it("leaves the choice empty when nothing has a category", () => {
    expect(
      planBulkApproval([{ categoryId: null, categorized: false }]),
    ).toEqual({ kind: "choose", prefillCategoryId: null });
  });
});

describe("suggestionWindowStart", () => {
  it("goes back 90 days across a month boundary", () => {
    expect(suggestionWindowStart(new Date(2026, 10, 8))).toBe("2026-08-10");
  });
});
