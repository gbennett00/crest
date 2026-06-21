import { describe, expect, it } from "vitest";

import {
  buildBudgetGroups,
  buildHistory,
  computePaymentCategoryActivity,
  computeReadyToAssign,
  findReadyToAssignId,
  paymentShortfallCents,
  type CreditTxn,
  type RawGroup,
} from "./compute";

const MONTH = "2026-06-01";

describe("buildHistory", () => {
  it("nests flat rows into id → month → cents", () => {
    const map = buildHistory([
      { id: "a", month: "2026-05-01", cents: 100 },
      { id: "a", month: "2026-06-01", cents: 200 },
      { id: "b", month: "2026-06-01", cents: -50 },
    ]);
    expect(map).toEqual({
      a: { "2026-05-01": 100, "2026-06-01": 200 },
      b: { "2026-06-01": -50 },
    });
  });

  it("returns an empty map for no rows", () => {
    expect(buildHistory([])).toEqual({});
  });
});

describe("computeReadyToAssign", () => {
  it("subtracts spending assignments from inflows", () => {
    expect(
      computeReadyToAssign({
        rtaActivityCents: 500_00,
        creditCardOpeningBalanceCents: 0,
        totalSpendingAssignedCents: 300_00,
      }),
    ).toBe(200_00);
  });

  it("backs out negative credit-card opening balances so debt is not assignable cash", () => {
    // A card opened with -100.00 of debt is categorized to RTA as -10000, but
    // must not reduce assignable cash. Subtracting the (negative) opening adds it back.
    expect(
      computeReadyToAssign({
        rtaActivityCents: 500_00 - 100_00, // inflow plus the -100 opening line
        creditCardOpeningBalanceCents: -100_00,
        totalSpendingAssignedCents: 0,
      }),
    ).toBe(500_00);
  });

  it("can go negative when over-assigned", () => {
    expect(
      computeReadyToAssign({
        rtaActivityCents: 100_00,
        creditCardOpeningBalanceCents: 0,
        totalSpendingAssignedCents: 150_00,
      }),
    ).toBe(-50_00);
  });
});

describe("computePaymentCategoryActivity", () => {
  // A credit-card transaction. Defaults: approved, non-transfer, on card "pay".
  const tx = (over: Partial<CreditTxn> & { amountCents: number }): CreditTxn => ({
    paymentCategoryId: "pay",
    month: MONTH,
    isTransfer: false,
    approved: true,
    allocations: [],
    ...over,
  });
  // An approved purchase fully allocated to one spending category (amount < 0).
  const purchase = (
    categoryId: string,
    amountCents: number,
    over: Partial<CreditTxn> = {},
  ): CreditTxn => tx({ amountCents, allocations: [{ categoryId, amountCents }], ...over });
  // An approved return/refund allocated back to one spending category (amount > 0).
  const refund = (categoryId: string, amountCents: number): CreditTxn =>
    tx({ amountCents, allocations: [{ categoryId, amountCents }] });

  it("reserves the full amount of a fully-funded purchase", () => {
    const { paymentActivity, breakdown } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: { groceries: { [MONTH]: -100_00 } },
      catAssigned: { groceries: { [MONTH]: 100_00 } },
      creditTxns: [purchase("groceries", -100_00)],
    });
    expect(paymentActivity["pay"][MONTH]).toBe(100_00);
    expect(breakdown["pay"]).toEqual({
      spendingCents: -100_00,
      returnsCents: 0,
      totalSpendingCents: -100_00,
      fundedSpendingCents: 100_00,
      paymentsAndReturnsCents: 0,
      totalActivityCents: 100_00,
    });
  });

  it("caps funded spending when the spending category is underfunded", () => {
    // Assigned 80, spent 100 on the card → only 80 was actually covered.
    const { paymentActivity, breakdown } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: { groceries: { [MONTH]: -100_00 } },
      catAssigned: { groceries: { [MONTH]: 80_00 } },
      creditTxns: [purchase("groceries", -100_00)],
    });
    expect(paymentActivity["pay"][MONTH]).toBe(80_00);
    expect(breakdown["pay"].spendingCents).toBe(-100_00); // gross still full
    expect(breakdown["pay"].fundedSpendingCents).toBe(80_00);
    expect(breakdown["pay"].totalActivityCents).toBe(80_00);
  });

  it("funds nothing when the category had no money at all", () => {
    const { paymentActivity, breakdown } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: { groceries: { [MONTH]: -100_00 } },
      catAssigned: {},
      creditTxns: [purchase("groceries", -100_00)],
    });
    expect(paymentActivity["pay"]?.[MONTH] ?? 0).toBe(0);
    expect(breakdown["pay"].fundedSpendingCents).toBe(0);
    expect(breakdown["pay"].spendingCents).toBe(-100_00);
  });

  it("counts an UNAPPROVED (uncategorized) purchase as gross spending but not funded", () => {
    // The reported bug: an uncategorized txn is unapproved (it can't be approved
    // without allocations). It must affect spending + register, but never funded.
    const { paymentActivity, breakdown } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: {}, // unapproved → not in the approved-only activity view
      catAssigned: {},
      creditTxns: [tx({ amountCents: -50_00, approved: false, allocations: [] })],
    });
    expect(paymentActivity["pay"]?.[MONTH] ?? 0).toBe(0); // payment available unchanged
    expect(breakdown["pay"].spendingCents).toBe(-50_00); // shows in spending
    expect(breakdown["pay"].fundedSpendingCents).toBe(0); // but not funded
    expect(breakdown["pay"].totalActivityCents).toBe(0);
  });

  it("treats an approved purchase with no allocations as unfunded gross spending", () => {
    // Defensive: the DB forbids approving without allocations, but the math must
    // not credit funded spending it can't attribute.
    const { breakdown } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: {},
      catAssigned: {},
      creditTxns: [tx({ amountCents: -20_00, approved: true, allocations: [] })],
    });
    expect(breakdown["pay"].spendingCents).toBe(-20_00);
    expect(breakdown["pay"].fundedSpendingCents).toBe(0);
  });

  it("funds credit spending only from what cash spending left behind (per-month)", () => {
    // Assigned 100, $100 cash spend (in the activity view, not a credit txn),
    // then $50 on the card → cash consumed the funds first, so credit funds 0.
    const { paymentActivity } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: { groceries: { [MONTH]: -150_00 } }, // -100 cash + -50 credit
      catAssigned: { groceries: { [MONTH]: 100_00 } },
      creditTxns: [purchase("groceries", -50_00)],
    });
    expect(paymentActivity["pay"]?.[MONTH] ?? 0).toBe(0);
  });

  it("drains the payment category for returns", () => {
    // Assigned 100, purchase 100, return 30 → funded 100, return releases 30.
    const { paymentActivity, breakdown } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: { groceries: { [MONTH]: -100_00 + 30_00 } },
      catAssigned: { groceries: { [MONTH]: 100_00 } },
      creditTxns: [purchase("groceries", -100_00), refund("groceries", 30_00)],
    });
    expect(paymentActivity["pay"][MONTH]).toBe(70_00);
    expect(breakdown["pay"]).toEqual({
      spendingCents: -100_00,
      returnsCents: 30_00,
      totalSpendingCents: -70_00,
      fundedSpendingCents: 100_00,
      paymentsAndReturnsCents: -30_00,
      totalActivityCents: 70_00,
    });
  });

  it("drains the payment category on transfer payments to the card", () => {
    const { paymentActivity, breakdown } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: {},
      catAssigned: {},
      creditTxns: [tx({ amountCents: 25_00, isTransfer: true })],
    });
    expect(paymentActivity["pay"][MONTH]).toBe(-25_00);
    expect(breakdown["pay"].paymentsAndReturnsCents).toBe(-25_00);
    expect(breakdown["pay"].totalActivityCents).toBe(-25_00);
  });

  it("ignores non-payment transfers (e.g. a transfer out of the card)", () => {
    const { paymentActivity, breakdown } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: {},
      catAssigned: {},
      creditTxns: [tx({ amountCents: -40_00, isTransfer: true })],
    });
    expect(paymentActivity["pay"]).toBeUndefined();
    expect(breakdown["pay"]).toBeUndefined();
  });

  it("counts prior-month assignments as funds when capping", () => {
    // 60 assigned in May + 50 in June = 110 available before a 100 June purchase.
    const { paymentActivity } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: { groceries: { [MONTH]: -100_00 } },
      catAssigned: { groceries: { "2026-05-01": 60_00, [MONTH]: 50_00 } },
      creditTxns: [purchase("groceries", -100_00)],
    });
    expect(paymentActivity["pay"][MONTH]).toBe(100_00);
  });

  it("splits the funded cap proportionally across cards", () => {
    // 100 funds, 100 spent on each of two cards → 50 funded to each.
    const { paymentActivity } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: { groceries: { [MONTH]: -200_00 } },
      catAssigned: { groceries: { [MONTH]: 100_00 } },
      creditTxns: [
        purchase("groceries", -100_00, { paymentCategoryId: "payA" }),
        purchase("groceries", -100_00, { paymentCategoryId: "payB" }),
      ],
    });
    expect(paymentActivity["payA"][MONTH]).toBe(50_00);
    expect(paymentActivity["payB"][MONTH]).toBe(50_00);
  });

  it("funds group-budgeted categories from the group's available, not the category's", () => {
    // The group is funded at the group level (100 assigned to the group); its
    // category has the credit spend but no category-level assignment. Without
    // group context the category looks fully unfunded; with it, it's covered.
    const args = {
      throughMonth: MONTH,
      catActivity: { groceries: { [MONTH]: -100_00 } },
      catAssigned: {},
      grpActivity: { food: { [MONTH]: -100_00 } },
      grpAssigned: { food: { [MONTH]: 100_00 } },
      categoryGroup: new Map([
        ["groceries", { groupId: "food", mode: "group" as const }],
      ]),
      creditTxns: [purchase("groceries", -100_00)],
    };
    expect(computePaymentCategoryActivity(args).paymentActivity["pay"][MONTH]).toBe(
      100_00,
    );

    // Without the group mapping the same spend reads as unfunded.
    expect(
      computePaymentCategoryActivity({ ...args, categoryGroup: new Map() })
        .paymentActivity["pay"]?.[MONTH] ?? 0,
    ).toBe(0);
  });

  it("pools two categories in the same group-budgeted group", () => {
    // Group funded 100; two categories each spend 60 on the card (120 total) →
    // only 100 is funded, split proportionally (50/50).
    const { paymentActivity, breakdown } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: {},
      catAssigned: {},
      grpActivity: { food: { [MONTH]: -120_00 } },
      grpAssigned: { food: { [MONTH]: 100_00 } },
      categoryGroup: new Map([
        ["groceries", { groupId: "food", mode: "group" as const }],
        ["dining", { groupId: "food", mode: "group" as const }],
      ]),
      creditTxns: [purchase("groceries", -60_00), purchase("dining", -60_00)],
    });
    expect(paymentActivity["pay"][MONTH]).toBe(100_00);
    expect(breakdown["pay"].spendingCents).toBe(-120_00);
    expect(breakdown["pay"].fundedSpendingCents).toBe(100_00);
  });

  it("ignores activity after the viewed month", () => {
    const { paymentActivity, breakdown } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: { groceries: { "2026-07-01": -40_00 } },
      catAssigned: { groceries: { "2026-07-01": 40_00 } },
      creditTxns: [purchase("groceries", -40_00, { month: "2026-07-01" })],
    });
    expect(paymentActivity["pay"]).toBeUndefined();
    expect(breakdown["pay"]).toBeUndefined();
  });

  it("rolls funded spending forward across months but reports only the viewed month", () => {
    // May purchase fully funded; June view: the May reserve is in paymentActivity
    // for May, and June's breakdown is empty.
    const { paymentActivity, breakdown } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: { groceries: { "2026-05-01": -30_00 } },
      catAssigned: { groceries: { "2026-05-01": 30_00 } },
      creditTxns: [purchase("groceries", -30_00, { month: "2026-05-01" })],
    });
    expect(paymentActivity["pay"]["2026-05-01"]).toBe(30_00);
    expect(paymentActivity["pay"][MONTH]).toBeUndefined();
    expect(breakdown["pay"].spendingCents).toBe(0); // nothing this month
  });

  it("matches the YNAB-style breakdown (partly-funded spending + returns)", () => {
    // assigned 518.71, spent 604.59, returned 47.28 → 38.60 uncovered.
    const { paymentActivity, breakdown } = computePaymentCategoryActivity({
      throughMonth: MONTH,
      catActivity: { groceries: { [MONTH]: -604_59 + 47_28 } },
      catAssigned: { groceries: { [MONTH]: 518_71 } },
      creditTxns: [purchase("groceries", -604_59), refund("groceries", 47_28)],
    });
    expect(breakdown["pay"]).toEqual({
      spendingCents: -604_59,
      returnsCents: 47_28,
      totalSpendingCents: -557_31,
      fundedSpendingCents: 565_99,
      paymentsAndReturnsCents: -47_28,
      totalActivityCents: 518_71,
    });
    expect(paymentActivity["pay"][MONTH]).toBe(518_71);
  });
});

describe("paymentShortfallCents", () => {
  it("is 0 for non-payment categories (null register balance)", () => {
    expect(paymentShortfallCents(0, null)).toBe(0);
    expect(paymentShortfallCents(-50_00, null)).toBe(0);
  });

  it("is 0 when the card is in credit (no debt)", () => {
    expect(paymentShortfallCents(0, 25_00)).toBe(0);
  });

  it("is 0 when available fully covers the debt", () => {
    expect(paymentShortfallCents(100_00, -100_00)).toBe(0);
    expect(paymentShortfallCents(120_00, -100_00)).toBe(0);
  });

  it("is the uncovered remainder when underfunded", () => {
    // e.g. an unapproved/uncategorized purchase added debt but no funding.
    expect(paymentShortfallCents(80_00, -100_00)).toBe(20_00);
    expect(paymentShortfallCents(0, -50_00)).toBe(50_00);
  });

  it("treats negative available as fully uncovered", () => {
    expect(paymentShortfallCents(-10_00, -100_00)).toBe(110_00);
  });
});

describe("findReadyToAssignId", () => {
  it("locates the RTA category across groups", () => {
    const groups: RawGroup[] = [
      {
        id: "g1",
        name: "Bills",
        budget_mode: "category",
        is_pinned: false,
        sort_index: 0,
        categories: [
          { id: "c1", name: "Rent", role: null, is_pinned: false, is_hidden: false, sort_index: 0 },
        ],
      },
      {
        id: "g2",
        name: "Inflows",
        budget_mode: "category",
        is_pinned: false,
        sort_index: 1,
        categories: [
          { id: "rta", name: "RTA", role: "ready_to_assign", is_pinned: false, is_hidden: false, sort_index: 0 },
        ],
      },
    ];
    expect(findReadyToAssignId(groups)).toBe("rta");
  });

  it("returns null when absent", () => {
    expect(findReadyToAssignId([])).toBeNull();
  });
});

describe("buildBudgetGroups", () => {
  const baseGroups: RawGroup[] = [
    {
      id: "g1",
      name: "Monthly Bills",
      budget_mode: "category",
      is_pinned: false,
      sort_index: 0,
      categories: [
        { id: "c-rent", name: "Rent", role: null, is_pinned: false, is_hidden: false, sort_index: 1 },
        { id: "c-water", name: "Water", role: null, is_pinned: true, is_hidden: false, sort_index: 0 },
      ],
    },
  ];

  it("sorts categories by sort_index", () => {
    const groups = buildBudgetGroups({
      groups: baseGroups,
      month: MONTH,
      catActivity: {},
      catAssigned: {},
      grpActivity: {},
      grpAssigned: {},
      catTargets: {},
      grpTargets: {},
      cardRegisterBalance: new Map(),
      cardBreakdown: {},
    });
    expect(groups[0].categories.map((c) => c.id)).toEqual(["c-water", "c-rent"]);
  });

  it("rolls assigned + activity forward into available", () => {
    const groups = buildBudgetGroups({
      groups: baseGroups,
      month: MONTH,
      catActivity: { "c-rent": { "2026-06-01": -100_00 } },
      catAssigned: { "c-rent": { "2026-05-01": 60_00, "2026-06-01": 50_00 } },
      grpActivity: {},
      grpAssigned: {},
      catTargets: {},
      grpTargets: {},
      cardRegisterBalance: new Map(),
      cardBreakdown: {},
    });
    const rent = groups[0].categories.find((c) => c.id === "c-rent")!;
    expect(rent.assignedCents).toBe(50_00);
    expect(rent.activityCents).toBe(-100_00);
    // 60 (May) + 50 (June) − 100 (June spend) = 10.00 available
    expect(rent.availableCents).toBe(10_00);
  });

  it("never reports a spendable available for the RTA row", () => {
    const groups = buildBudgetGroups({
      groups: [
        {
          id: "g-in",
          name: "Inflows",
          budget_mode: "category",
          is_pinned: false,
          sort_index: 0,
          categories: [
            { id: "rta", name: "RTA", role: "ready_to_assign", is_pinned: false, is_hidden: false, sort_index: 0 },
          ],
        },
      ],
      month: MONTH,
      catActivity: { rta: { "2026-06-01": 999_00 } },
      catAssigned: {},
      grpActivity: {},
      grpAssigned: {},
      catTargets: {},
      grpTargets: {},
      cardRegisterBalance: new Map(),
      cardBreakdown: {},
    });
    expect(groups[0].categories[0].availableCents).toBe(0);
  });

  it("attaches the card register balance to payment categories", () => {
    const groups = buildBudgetGroups({
      groups: baseGroups,
      month: MONTH,
      catActivity: {},
      catAssigned: {},
      grpActivity: {},
      grpAssigned: {},
      catTargets: {},
      grpTargets: {},
      cardRegisterBalance: new Map([["c-rent", -250_00]]),
      cardBreakdown: {},
    });
    const rent = groups[0].categories.find((c) => c.id === "c-rent")!;
    expect(rent.cardRegisterBalanceCents).toBe(-250_00);
  });
});
