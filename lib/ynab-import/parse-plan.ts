import { parseCsv } from "./csv";
import { parseDollarsToCents, parseMonthYear } from "./money";
import type { ParsedAssignment, PlanParseResult } from "./types";

function columnIndex(header: string[], name: string): number {
  const idx = header.indexOf(name);
  if (idx === -1) {
    throw new Error(`Plan.csv missing expected column: ${name}`);
  }
  return idx;
}

export function parsePlanCsv(csvText: string): PlanParseResult {
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return { assignments: [], warnings: [] };
  }

  const header = rows[0].map((h) => h.trim());
  const idx = {
    month: columnIndex(header, "Month"),
    categoryGroup: columnIndex(header, "Category Group"),
    category: columnIndex(header, "Category"),
    assigned: columnIndex(header, "Assigned"),
  };

  const assignments: ParsedAssignment[] = [];

  for (const r of rows.slice(1)) {
    const assignedCents = parseDollarsToCents(r[idx.assigned] ?? "0");
    if (assignedCents === 0) continue;

    const categoryGroup = r[idx.categoryGroup]?.trim() ?? "";
    const category = r[idx.category]?.trim() ?? "";

    assignments.push({
      month: parseMonthYear(r[idx.month] ?? ""),
      categoryGroup,
      category,
      isCreditCardPayment: categoryGroup === "Credit Card Payments",
      assignedCents,
    });
  }

  return { assignments, warnings: [] };
}
