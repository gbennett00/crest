// Rank-based category colors (biggest spend = index 0), shared by the donut
// chart and the breakdown list so a category's dot always matches its slice.
export const REPORT_COLORS = [
  "#274754",
  "#0d966d",
  "#e76e50",
  "#e8c468",
  "#2a9d90",
  "#f4a462",
  "#6b8fb5",
  "#a8a29e",
];

export function colorForIndex(index: number): string {
  return REPORT_COLORS[index % REPORT_COLORS.length];
}
