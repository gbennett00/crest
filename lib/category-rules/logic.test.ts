import { describe, expect, it } from "vitest";

import {
  describeRuleConditions,
  ruleTargetsPayee,
  shouldOfferRule,
  validateRuleInput,
} from "./logic";
import type { CategoryRuleInput } from "./types";

const base: CategoryRuleInput = {
  matchType: "exact",
  matchText: "Maverik",
  direction: "outflow",
  minCents: null,
  maxCents: null,
  accountId: null,
  categoryId: "cat-allowance",
};

describe("validateRuleInput", () => {
  it("accepts a plain exact rule", () => {
    expect(validateRuleInput(base)).toBeNull();
  });

  it("requires match text and a category", () => {
    expect(validateRuleInput({ ...base, matchText: "   " })).toMatch(/payee text/);
    expect(validateRuleInput({ ...base, categoryId: "" })).toMatch(/category/);
  });

  it("requires 3+ characters for contains rules only", () => {
    expect(validateRuleInput({ ...base, matchType: "contains", matchText: "ab" })).toMatch(/3/);
    expect(validateRuleInput({ ...base, matchType: "contains", matchText: "amz" })).toBeNull();
    expect(validateRuleInput({ ...base, matchText: "76" })).toBeNull();
  });

  it("requires an ordered, non-negative amount range", () => {
    expect(validateRuleInput({ ...base, minCents: 2000, maxCents: 2000 })).toMatch(/less than/);
    expect(validateRuleInput({ ...base, minCents: 2001, maxCents: 2000 })).toMatch(/less than/);
    expect(validateRuleInput({ ...base, minCents: -1 })).toMatch(/zero or more/);
    expect(validateRuleInput({ ...base, maxCents: 0 })).toMatch(/more than/);
    expect(validateRuleInput({ ...base, minCents: 0, maxCents: 2000 })).toBeNull();
  });
});

describe("ruleTargetsPayee", () => {
  it("matches exact keys only exactly", () => {
    const rule = { matchType: "exact" as const, matchText: "maverik", direction: "outflow" as const };
    expect(ruleTargetsPayee(rule, "maverik", "outflow")).toBe(true);
    expect(ruleTargetsPayee(rule, "maverik slc", "outflow")).toBe(false);
  });

  it("matches contains rules on a substring", () => {
    const rule = { matchType: "contains" as const, matchText: "amazon", direction: "outflow" as const };
    expect(ruleTargetsPayee(rule, "amazon mktplace", "outflow")).toBe(true);
    expect(ruleTargetsPayee(rule, "amzn", "outflow")).toBe(false);
  });

  it("never matches the other direction", () => {
    const rule = { matchType: "exact" as const, matchText: "maverik", direction: "outflow" as const };
    expect(ruleTargetsPayee(rule, "maverik", "inflow")).toBe(false);
  });
});

describe("shouldOfferRule", () => {
  const pick = (categoryId: string) => [{ categoryId }];

  it("offers when categorizing an uncategorized transaction", () => {
    expect(shouldOfferRule([], pick("a"))).toBe(true);
  });

  it("offers when overriding a different category", () => {
    expect(shouldOfferRule(["a"], pick("b"))).toBe(true);
  });

  it("does not offer when keeping the same category", () => {
    expect(shouldOfferRule(["a"], pick("a"))).toBe(false);
  });

  it("does not offer for splits or for clearing the category", () => {
    expect(shouldOfferRule([], [{ categoryId: "a" }, { categoryId: "b" }])).toBe(false);
    expect(shouldOfferRule(["a"], [])).toBe(false);
  });

  it("offers when collapsing a split into one category", () => {
    expect(shouldOfferRule(["a", "b"], pick("a"))).toBe(true);
  });
});

describe("describeRuleConditions", () => {
  it("describes direction alone", () => {
    expect(describeRuleConditions(base, null)).toBe("Outflow");
  });

  it("describes each amount range shape", () => {
    expect(describeRuleConditions({ ...base, maxCents: 2000 }, null)).toBe("Outflow · under $20.00");
    expect(describeRuleConditions({ ...base, minCents: 2000 }, null)).toBe("Outflow · $20.00 or more");
    expect(describeRuleConditions({ ...base, minCents: 500, maxCents: 2000 }, null)).toBe(
      "Outflow · $5.00 to under $20.00",
    );
  });

  it("includes the account and inflow direction", () => {
    expect(describeRuleConditions({ ...base, direction: "inflow" }, "Checking")).toBe(
      "Inflow · Checking",
    );
  });
});
