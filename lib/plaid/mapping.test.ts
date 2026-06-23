import { describe, expect, it } from "vitest";

import {
  plaidAccountTypeToCrest,
  plaidAmountToCents,
  plaidBalanceToBalanceCents,
  plaidTxnToUpsertInput,
} from "./mapping";

describe("plaidAmountToCents", () => {
  it("flips sign: Plaid positive outflow → Crest negative", () => {
    expect(plaidAmountToCents(12.34)).toBe(-1234);
  });

  it("flips sign: Plaid negative inflow → Crest positive", () => {
    expect(plaidAmountToCents(-50.0)).toBe(5000);
  });

  it("rounds float-to-cents correctly", () => {
    // 1.005 * 100 = 100.49999… in IEEE 754, so Math.round → 100
    expect(plaidAmountToCents(1.005)).toBe(-100);
    // 1.015 * 100 = 101.49999… → 101
    expect(plaidAmountToCents(1.015)).toBe(-101);
    // Clean halves round up
    expect(plaidAmountToCents(1.125)).toBe(-113);
  });

  it("handles zero", () => {
    expect(plaidAmountToCents(0)).toBe(0);
  });

  it("always returns an integer", () => {
    const result = plaidAmountToCents(33.33);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(-3333);
  });
});

describe("plaidBalanceToBalanceCents", () => {
  it("depository account: positive balance maps directly", () => {
    const account = {
      balances: { current: 1500.5, available: null, limit: null, iso_currency_code: "USD", unofficial_currency_code: null },
      type: "depository",
    };
    expect(plaidBalanceToBalanceCents(account as never)).toBe(150050);
  });

  it("credit account: positive amount owed → negative Crest balance", () => {
    const account = {
      balances: { current: 450.0, available: null, limit: null, iso_currency_code: "USD", unofficial_currency_code: null },
      type: "credit",
    };
    expect(plaidBalanceToBalanceCents(account as never)).toBe(-45000);
  });

  it("handles null current balance as zero", () => {
    const account = {
      balances: { current: null, available: null, limit: null, iso_currency_code: "USD", unofficial_currency_code: null },
      type: "depository",
    };
    expect(plaidBalanceToBalanceCents(account as never)).toBe(0);
  });
});

describe("plaidAccountTypeToCrest", () => {
  it("maps credit type", () => {
    expect(plaidAccountTypeToCrest("credit", "credit card")).toBe("credit");
  });

  it("maps savings subtype", () => {
    expect(plaidAccountTypeToCrest("depository", "savings")).toBe("savings");
  });

  it("maps money market to savings", () => {
    expect(plaidAccountTypeToCrest("depository", "money market")).toBe(
      "savings",
    );
  });

  it("maps cd to savings", () => {
    expect(plaidAccountTypeToCrest("depository", "cd")).toBe("savings");
  });

  it("defaults to checking", () => {
    expect(plaidAccountTypeToCrest("depository", "checking")).toBe("checking");
  });

  it("unknown type defaults to checking", () => {
    expect(plaidAccountTypeToCrest("loan", null)).toBe("checking");
  });
});

describe("plaidTxnToUpsertInput", () => {
  const baseTxn = {
    transaction_id: "txn_abc123",
    account_id: "plaid_acct_1",
    amount: 25.5,
    date: "2026-06-15",
    name: "GROCERY STORE",
    merchant_name: "Whole Foods",
    pending: false,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    category: null,
    category_id: null,
    authorized_date: null,
    authorized_datetime: null,
    datetime: null,
    payment_channel: "in store" as const,
    location: {} as never,
    payment_meta: {} as never,
    account_owner: null,
    personal_finance_category: null,
    personal_finance_category_icon_url: "",
    transaction_code: null,
    check_number: null,
    pending_transaction_id: null,
    merchant_entity_id: null,
    logo_url: null,
    website: null,
    counterparties: [],
  };

  it("maps fields correctly", () => {
    const result = plaidTxnToUpsertInput(baseTxn as never, "crest-acct-uuid");
    expect(result.accountId).toBe("crest-acct-uuid");
    expect(result.amountCents).toBe(-2550);
    expect(result.txnDate).toBe("2026-06-15");
    expect(result.payee).toBe("Whole Foods");
    expect(result.importedId).toBe("txn_abc123");
    expect(result.approvedAt).toBeNull();
    expect(result.clearedAt).not.toBeNull();
  });

  it("uses name when merchant_name is null", () => {
    const txn = { ...baseTxn, merchant_name: null };
    const result = plaidTxnToUpsertInput(txn as never, "crest-acct-uuid");
    expect(result.payee).toBe("GROCERY STORE");
  });

  it("sets clearedAt to null for pending transactions", () => {
    const txn = { ...baseTxn, pending: true };
    const result = plaidTxnToUpsertInput(txn as never, "crest-acct-uuid");
    expect(result.clearedAt).toBeNull();
  });

  it("inflow: negative Plaid amount → positive Crest cents", () => {
    const txn = { ...baseTxn, amount: -100.0 };
    const result = plaidTxnToUpsertInput(txn as never, "crest-acct-uuid");
    expect(result.amountCents).toBe(10000);
  });
});
