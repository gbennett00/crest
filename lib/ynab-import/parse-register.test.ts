import { describe, expect, it } from "vitest";

import { parseRegisterCsv } from "./parse-register";

const HEADER =
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\r\n");
}

describe("parseRegisterCsv", () => {
  it("strips a UTF-8 BOM before parsing the header", () => {
    const withBom = "﻿" + csv(
      '"Checking","","01/15/2026","Coffee Shop","General: Dining","General","Dining","",$4.50,$0.00,"Cleared"',
    );
    const result = parseRegisterCsv(withBom);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].account).toBe("Checking");
  });

  it("parses a plain categorized outflow as a negative-amount, approved transaction", () => {
    const result = parseRegisterCsv(
      csv('"Checking","","01/15/2026","Coffee Shop","General: Dining","General","Dining","",$4.50,$0.00,"Cleared"'),
    );
    expect(result.transactions).toEqual([
      expect.objectContaining({
        account: "Checking",
        date: "2026-01-15",
        payee: "Coffee Shop",
        amountCents: -450,
        cleared: true,
        allocations: [{ categoryGroup: "General", category: "Dining", amountCents: -450 }],
      }),
    ]);
  });

  it("parses an inflow as a positive amount", () => {
    const result = parseRegisterCsv(
      csv('"Checking","","01/15/2026","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$1500.00,"Cleared"'),
    );
    expect(result.transactions[0].amountCents).toBe(150000);
  });

  it("parses negative-formatted and comma-thousands dollar amounts", () => {
    const result = parseRegisterCsv(
      csv('"Checking","","01/15/2026","Refund","General: Dining","General","Dining","",$0.00,"$1,234.56","Cleared"'),
    );
    expect(result.transactions[0].amountCents).toBe(123456);
  });

  it("treats Uncleared as not cleared and Reconciled as cleared", () => {
    const result = parseRegisterCsv(
      csv(
        '"Checking","","01/15/2026","A","General: Dining","General","Dining","",$1.00,$0.00,"Uncleared"',
        '"Checking","","01/15/2026","B","General: Dining","General","Dining","",$1.00,$0.00,"Reconciled"',
      ),
    );
    expect(result.transactions[0].cleared).toBe(false);
    expect(result.transactions[1].cleared).toBe(true);
  });

  it("leaves genuinely uncategorized rows with no allocations (pending import)", () => {
    const result = parseRegisterCsv(
      csv('"Checking","","01/15/2026","Mystery","","","","",$5.00,$0.00,"Uncleared"'),
    );
    expect(result.transactions[0].allocations).toEqual([]);
  });

  it("groups Split (i/N) rows into one transaction with multiple allocations, without merging an adjacent non-split row sharing the same account/date/payee", () => {
    const result = parseRegisterCsv(
      csv(
        '"Crew","","07/01/2026","Venmo","Bills: Rent","Bills","Rent","Split (1/2) ",$1450.00,$0.00,"Cleared"',
        '"Crew","","07/01/2026","Venmo","Bills: TV","Bills","TV","Split (2/2) ",$50.00,$0.00,"Cleared"',
        '"Crew","","07/01/2026","Venmo","Bills: TV","Bills","TV","",$57.00,$0.00,"Cleared"',
      ),
    );
    expect(result.transactions).toHaveLength(2);
    const split = result.transactions.find((t) => t.amountCents === -150000);
    expect(split).toBeDefined();
    expect(split!.allocations).toEqual([
      { categoryGroup: "Bills", category: "Rent", amountCents: -145000 },
      { categoryGroup: "Bills", category: "TV", amountCents: -5000 },
    ]);
    const unsplit = result.transactions.find((t) => t.amountCents === -5700);
    expect(unsplit).toBeDefined();
    expect(unsplit!.memo).toBe("");
  });

  it("pairs Transfer : <Account> rows across accounts into a single transfer, never as normal transactions", () => {
    const result = parseRegisterCsv(
      csv(
        '"Crew","","06/27/2026","Transfer : BoA Atmos","","","","",$2289.94,$0.00,"Cleared"',
        '"BoA Atmos","","06/27/2026","Transfer : Crew","","","","",$0.00,$2289.94,"Cleared"',
      ),
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.transfers).toEqual([
      expect.objectContaining({
        fromAccount: "Crew",
        toAccount: "BoA Atmos",
        amountCents: 228994,
        cleared: true,
      }),
    ]);
  });

  it("does not treat a categorized payee merely containing the word transfer as a real transfer", () => {
    const result = parseRegisterCsv(
      csv('"Checking","","07/03/2026","Transfer to Venmo","Wants: Allowance","Wants","Allowance","",$5.00,$0.00,"Cleared"'),
    );
    expect(result.transfers).toHaveLength(0);
    expect(result.transactions).toHaveLength(1);
  });

  it("warns on an unmatched transfer half instead of importing it as a normal transaction", () => {
    const result = parseRegisterCsv(
      csv('"Crew","","06/27/2026","Transfer : Nonexistent Account","","","","",$100.00,$0.00,"Cleared"'),
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.transfers).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/Unmatched transfer row/);
  });

  it("routes an on-budget Starting Balance row to openingBalances, not transactions", () => {
    const result = parseRegisterCsv(
      csv('"Checking","","01/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$1500.00,"Reconciled"'),
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.openingBalances).toEqual([
      { account: "Checking", date: "2026-01-01", amountCents: 150000, onBudget: true },
    ]);
    expect(result.offBudgetAccounts).toEqual([]);
  });

  it("imports the on-budget leg of a transfer to a tracking account as a normal categorized transaction, and silently drops the tracking-account leg without a warning", () => {
    const result = parseRegisterCsv(
      csv(
        '"Brokerage","","02/26/2026","Starting Balance","","","","",$0.00,$0.00,"Reconciled"',
        '"Checking","","03/23/2026","Transfer : Brokerage","Non-monthly: Transfers","Non-monthly","Transfers","",$7500.00,$0.00,"Reconciled"',
        '"Brokerage","","03/23/2026","Transfer : Checking","","","","",$0.00,$7500.00,"Reconciled"',
      ),
    );
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      account: "Checking",
      payee: "Transfer : Brokerage",
      amountCents: -750000,
      allocations: [{ categoryGroup: "Non-monthly", category: "Transfers", amountCents: -750000 }],
    });
    expect(result.transfers).toHaveLength(0);
    expect(result.warnings).toEqual([]);
  });

  it("flags an off-budget (blank category) Starting Balance row as a tracking-account signal", () => {
    const result = parseRegisterCsv(
      csv('"Brokerage","","02/26/2026","Starting Balance","","","","",$0.00,$483.25,"Reconciled"'),
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.openingBalances).toEqual([
      { account: "Brokerage", date: "2026-02-26", amountCents: 48325, onBudget: false },
    ]);
    expect(result.offBudgetAccounts).toEqual(["Brokerage"]);
  });
});
