import { describe, expect, it } from "vitest";

import { throwOnQueryErrors } from "./query-errors";

describe("throwOnQueryErrors", () => {
  it("passes when no query errored, including results with no error field", () => {
    expect(() =>
      throwOnQueryErrors({ groups: { error: null }, skipped: {} }),
    ).not.toThrow();
  });

  it("throws naming the query that failed and the database's message", () => {
    expect(() =>
      throwOnQueryErrors({
        groups: { error: null },
        targets: { error: { message: "column targets.repeat_interval_months does not exist" } },
      }),
    ).toThrow("Failed to load targets: column targets.repeat_interval_months does not exist");
  });
});
