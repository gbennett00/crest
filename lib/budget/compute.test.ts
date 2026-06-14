import { describe, expect, it } from "vitest";

import { OPENING_BALANCE_IMPORTED_ID } from "@/lib/ledger";
import {
  buildBudgetGroups,
  buildHistory,
  computeReadyToAssign,
  findReadyToAssignId,
  injectCreditCardActivity,
  type CreditCardTxn,
  type MonthlyCents,
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

describe("injectCreditCardActivity", () => {
  const accountToCat = new Map([["card-1", "pay-cat"]]);

  it("adds categorized purchases to the payment category as positive activity", () => {
    const cat: MonthlyCents = {};
    const txns: CreditCardTxn[] = [
      {
        accountId: "card-1",
        amountCents: -40_00,
        txnDate: "2026-06-15",
        importedId: null,
        isTransfer: false,
        hasAllocations: true,
      },
    ];
    injectCreditCardActivity(cat, txns, accountToCat);
    expect(cat["pay-cat"]["2026-06-01"]).toBe(40_00);
  });

  it("drains the payment category on transfer payments to the card", () => {
    const cat: MonthlyCents = {};
    const txns: CreditCardTxn[] = [
      {
        accountId: "card-1",
        amountCents: 25_00,
        txnDate: "2026-06-20",
        importedId: null,
        isTransfer: true,
        hasAllocations: false,
      },
    ];
    injectCreditCardActivity(cat, txns, accountToCat);
    expect(cat["pay-cat"]["2026-06-01"]).toBe(-25_00);
  });

  it("ignores opening-balance transactions and unallocated purchases", () => {
    const cat: MonthlyCents = {};
    const txns: CreditCardTxn[] = [
      {
        accountId: "card-1",
        amountCents: -100_00,
        txnDate: "2026-06-01",
        importedId: OPENING_BALANCE_IMPORTED_ID,
        isTransfer: false,
        hasAllocations: true,
      },
      {
        accountId: "card-1",
        amountCents: -10_00,
        txnDate: "2026-06-05",
        importedId: null,
        isTransfer: false,
        hasAllocations: false, // unapproved / no splits
      },
    ];
    injectCreditCardActivity(cat, txns, accountToCat);
    expect(cat["pay-cat"]).toBeUndefined();
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
        categories: [
          { id: "c1", name: "Rent", role: null, is_pinned: false, is_hidden: false },
        ],
      },
      {
        id: "g2",
        name: "Inflows",
        budget_mode: "category",
        is_pinned: false,
        categories: [
          { id: "rta", name: "RTA", role: "ready_to_assign", is_pinned: false, is_hidden: false },
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
      categories: [
        { id: "c-rent", name: "Rent", role: null, is_pinned: false, is_hidden: false },
        { id: "c-water", name: "Water", role: null, is_pinned: true, is_hidden: false },
      ],
    },
  ];

  it("sorts categories pinned-first then alphabetically", () => {
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
          categories: [
            { id: "rta", name: "RTA", role: "ready_to_assign", is_pinned: false, is_hidden: false },
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
    });
    const rent = groups[0].categories.find((c) => c.id === "c-rent")!;
    expect(rent.cardRegisterBalanceCents).toBe(-250_00);
  });
});
