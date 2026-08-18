import { describe, expect, it } from "vitest";

import { parsePlanCsv } from "./parse-plan";

const HEADER = '"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\r\n");
}

describe("parsePlanCsv", () => {
  it("parses a normal assigned row and its month", () => {
    const result = parsePlanCsv(
      csv('"Jan 2026","General: Groceries","General","Groceries",$194.74,$0.00,$194.74'),
    );
    expect(result.assignments).toEqual([
      {
        month: "2026-01-01",
        categoryGroup: "General",
        category: "Groceries",
        isCreditCardPayment: false,
        assignedCents: 19474,
      },
    ]);
  });

  it("skips zero-Assigned rows", () => {
    const result = parsePlanCsv(
      csv('"Jan 2026","General: Groceries","General","Groceries",$0.00,$0.00,$0.00'),
    );
    expect(result.assignments).toEqual([]);
  });

  it("parses negative Assigned amounts (unassigning back to Ready to Assign)", () => {
    const result = parsePlanCsv(
      csv('"Apr 2026","General: Entertainment","General","Entertainment",-$7.41,$0.00,$41.50'),
    );
    expect(result.assignments[0].assignedCents).toBe(-741);
  });

  it("flags Credit Card Payments rows for account-payment-category resolution", () => {
    const result = parsePlanCsv(
      csv('"Feb 2026","Credit Card Payments: Quicksilver","Credit Card Payments","Quicksilver",$25.81,-$25.81,$0.00'),
    );
    expect(result.assignments[0]).toMatchObject({
      isCreditCardPayment: true,
      category: "Quicksilver",
      assignedCents: 2581,
    });
  });

  it("parses every month abbreviation to a first-of-month date", () => {
    const result = parsePlanCsv(
      csv('"Dec 2026","General: Groceries","General","Groceries",$10.00,$0.00,$10.00'),
    );
    expect(result.assignments[0].month).toBe("2026-12-01");
  });
});
