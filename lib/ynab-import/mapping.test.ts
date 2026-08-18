import { describe, expect, it } from "vitest";

import { parseRegisterCsv } from "./parse-register";
import { parsePlanCsv } from "./parse-plan";
import {
  buildAccountMappingCandidates,
  buildCategoryMappingCandidates,
  collectCategoryPairs,
} from "./mapping";

const REGISTER_HEADER =
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"';
const PLAN_HEADER = '"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"';

function registerCsv(...rows: string[]): string {
  return [REGISTER_HEADER, ...rows].join("\r\n");
}
function planCsv(...rows: string[]): string {
  return [PLAN_HEADER, ...rows].join("\r\n");
}

describe("buildAccountMappingCandidates", () => {
  it("marks an exact-name existing account as matched and an unknown one as needing mapping", () => {
    const register = parseRegisterCsv(
      registerCsv(
        '"Checking","","01/15/2026","Coffee","General: Dining","General","Dining","",$4.50,$0.00,"Cleared"',
        '"Savings","","01/15/2026","Deposit","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$100.00,"Cleared"',
      ),
    );
    const candidates = buildAccountMappingCandidates(register, [
      { id: "acc-1", name: "Checking", type: "checking" },
    ]);
    expect(candidates).toEqual([
      { csvName: "Checking", looksOffBudget: false, existingMatch: { id: "acc-1", name: "Checking", type: "checking" } },
      { csvName: "Savings", looksOffBudget: false, existingMatch: null },
    ]);
  });

  it("flags accounts with an off-budget Starting Balance as looksOffBudget", () => {
    const register = parseRegisterCsv(
      registerCsv('"Brokerage","","02/26/2026","Starting Balance","","","","",$0.00,$483.25,"Reconciled"'),
    );
    const candidates = buildAccountMappingCandidates(register, []);
    expect(candidates).toEqual([{ csvName: "Brokerage", looksOffBudget: true, existingMatch: null }]);
  });
});

describe("collectCategoryPairs / buildCategoryMappingCandidates", () => {
  it("excludes the Ready to Assign and Credit Card Payments special cases from generic mapping", () => {
    const register = parseRegisterCsv(
      registerCsv(
        '"Checking","","01/15/2026","Coffee","General: Dining","General","Dining","",$4.50,$0.00,"Cleared"',
        '"Checking","","01/15/2026","Deposit","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$100.00,"Cleared"',
      ),
    );
    const plan = parsePlanCsv(
      planCsv('"Jan 2026","Credit Card Payments: Card","Credit Card Payments","Card",$25.00,$0.00,$25.00'),
    );
    const pairs = collectCategoryPairs(register, plan);
    expect(pairs).toEqual([{ categoryGroup: "General", category: "Dining" }]);
  });

  it("distinguishes existing group+category, existing group only, and fully new", () => {
    const register = parseRegisterCsv(
      registerCsv(
        '"Checking","","01/15/2026","A","General: Dining","General","Dining","",$1.00,$0.00,"Cleared"',
        '"Checking","","01/15/2026","B","General: Shopping","General","Shopping","",$1.00,$0.00,"Cleared"',
        '"Checking","","01/15/2026","C","NewGroup: NewCat","NewGroup","NewCat","",$1.00,$0.00,"Cleared"',
      ),
    );
    const plan = parsePlanCsv(planCsv());
    const candidates = buildCategoryMappingCandidates(
      register,
      plan,
      [{ id: "grp-1", name: "General" }],
      [{ id: "cat-1", name: "Dining", groupId: "grp-1" }],
    );
    expect(candidates).toEqual([
      {
        categoryGroup: "General",
        category: "Dining",
        existingCategoryMatch: { groupId: "grp-1", categoryId: "cat-1" },
        existingGroupMatch: { groupId: "grp-1" },
      },
      {
        categoryGroup: "General",
        category: "Shopping",
        existingCategoryMatch: null,
        existingGroupMatch: { groupId: "grp-1" },
      },
      {
        categoryGroup: "NewGroup",
        category: "NewCat",
        existingCategoryMatch: null,
        existingGroupMatch: null,
      },
    ]);
  });
});
