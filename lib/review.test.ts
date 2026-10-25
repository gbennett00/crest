import { describe, expect, it } from "vitest";
import {
  approvalTargets,
  approveLabel,
  approvedMessage,
  reviewSummary,
  selectedCount,
  splitByCategory,
  type ReviewRow,
} from "./review";

const rows: ReviewRow[] = [
  { id: "a", amountCents: -4663, categoryLabel: null },
  { id: "b", amountCents: -4886, categoryLabel: null },
  { id: "c", amountCents: -3710, categoryLabel: "Groceries" },
];
const fmt = (c: number) => (c < 0 ? `-$${(-c / 100).toFixed(2)}` : `$${(c / 100).toFixed(2)}`);

describe("approvalTargets", () => {
  it("is every row when nothing is selected", () => {
    expect(approvalTargets(rows, new Set()).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("is only the selected rows otherwise", () => {
    expect(approvalTargets(rows, new Set(["b", "c"])).map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("ignores selected ids that are no longer listed", () => {
    expect(approvalTargets(rows, new Set(["gone"])).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("selectedCount", () => {
  it("counts only listed rows", () => {
    expect(selectedCount(rows, new Set(["a", "gone"]))).toBe(1);
  });
});

describe("approveLabel", () => {
  it("says all when nothing is selected", () => {
    expect(approveLabel(10, false)).toBe("Approve all 10");
  });
  it("gives the count when something is selected", () => {
    expect(approveLabel(2, true)).toBe("Approve 2");
  });
});

describe("reviewSummary", () => {
  it("counts rows to review with no selection", () => {
    expect(reviewSummary(rows, new Set(), fmt)).toBe("3 to review");
  });

  it("shows the selected count and signed total", () => {
    expect(reviewSummary(rows, new Set(["a", "b"]), fmt)).toBe("2 selected · -$95.49");
  });

  it("nets inflows against outflows", () => {
    const mixed: ReviewRow[] = [
      { id: "x", amountCents: -1000, categoryLabel: null },
      { id: "y", amountCents: 2500, categoryLabel: null },
    ];
    expect(reviewSummary(mixed, new Set(["x", "y"]), fmt)).toBe("2 selected · $15.00");
  });
});

describe("splitByCategory", () => {
  it("separates uncategorized rows from ones that keep their category", () => {
    const { uncategorized, categorized } = splitByCategory(rows);
    expect(uncategorized.map((r) => r.id)).toEqual(["a", "b"]);
    expect(categorized.map((r) => r.id)).toEqual(["c"]);
  });
});

describe("approvedMessage", () => {
  it("reads like the toast", () => {
    expect(approvedMessage(2)).toBe("2 approved");
  });
});
