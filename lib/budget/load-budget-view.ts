import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  currentBudgetMonth,
  nextBudgetMonth,
  OPENING_BALANCE_IMPORTED_ID,
} from "@/lib/ledger";
import type { BudgetData, TargetData } from "./types";
import {
  buildBudgetGroups,
  buildHistory,
  computeReadyToAssign,
  findReadyToAssignId,
  injectCreditCardActivity,
  type CreditCardTxn,
  type HistoryRow,
  type MonthlyCents,
  type RawGroup,
} from "./compute";

// Single source of truth for the budget view consumed by both the budget screen
// and the home screen. The page components pass in only the month in view; all
// querying and math happens here (and, for the math, in ./compute).

/** Page-facing entry point: builds the budget view for the given month. */
export async function getBudgetView(month: string): Promise<BudgetData> {
  return loadBudgetView(await createClient(), month);
}

/**
 * Load and compute the full budget view for `month`.
 *
 * Ready to Assign is a *global* pool (assignable cash across all time), so it is
 * always computed through the current calendar month regardless of which month
 * is being viewed.
 */
export async function loadBudgetView(
  client: SupabaseClient,
  month: string,
): Promise<BudgetData> {
  const rtaThroughMonth = currentBudgetMonth();

  // Wave 1: everything needed to render spending categories/groups.
  const [
    groupsRes,
    catActivityRes,
    catAssignedRes,
    grpActivityRes,
    grpAssignedRes,
    targetsRes,
    ccAccountsRes,
  ] = await Promise.all([
    client
      .from("category_groups")
      .select("id, name, budget_mode, is_pinned, categories(id, name, role, is_pinned, is_hidden)")
      .order("is_pinned", { ascending: false })
      .order("name"),
    client
      .from("category_monthly_activity")
      .select("category_id, month, activity_cents")
      .lte("month", month),
    client
      .from("category_monthly_assigned")
      .select("category_id, month, assigned_cents")
      .lte("month", month),
    client
      .from("group_monthly_activity")
      .select("group_id, month, activity_cents")
      .lte("month", month),
    client
      .from("group_monthly_assigned")
      .select("group_id, month, assigned_cents")
      .lte("month", month),
    client
      .from("targets")
      .select("category_id, group_id, type, amount_cents, target_date"),
    // Credit-card accounts: their payment-category activity must be derived
    // because CC purchases are allocated to spending categories, not the
    // payment category itself.
    client
      .from("accounts")
      .select("id, payment_category_id")
      .eq("type", "credit")
      .not("payment_category_id", "is", null),
  ]);

  const groups = (groupsRes.data ?? []) as unknown as RawGroup[];
  const rtaId = findReadyToAssignId(groups);

  const ccAccountMap = new Map<string, string>(); // accountId → paymentCategoryId
  for (const a of (ccAccountsRes.data ?? []) as { id: string; payment_category_id: string }[]) {
    ccAccountMap.set(a.id, a.payment_category_id);
  }
  const ccAccountIds = [...ccAccountMap.keys()];

  // Wave 2: RTA inputs (activity through today, all spending assignments ever,
  // credit-card opening balances to back out).
  const [rtaActivityRes, allCatBudgetsRes, allGrpBudgetsRes, ccOpeningRes] =
    await Promise.all([
      rtaId
        ? client
            .from("category_monthly_activity")
            .select("activity_cents")
            .eq("category_id", rtaId)
            .lte("month", rtaThroughMonth)
        : Promise.resolve({ data: [] }),
      rtaId
        ? client
            .from("monthly_budgets")
            .select("assigned_cents")
            .not("category_id", "is", null)
            .neq("category_id", rtaId)
        : Promise.resolve({ data: [] }),
      client
        .from("monthly_budgets")
        .select("assigned_cents")
        .not("group_id", "is", null),
      ccAccountIds.length > 0
        ? client
            .from("transactions")
            .select("amount_cents")
            .in("account_id", ccAccountIds)
            .eq("imported_id", OPENING_BALANCE_IMPORTED_ID)
        : Promise.resolve({ data: [] }),
    ]);

  // Build the spending-category / group history maps.
  const catActivity = buildHistory(
    toHistoryRows(catActivityRes.data, "category_id", "activity_cents"),
  );
  const catAssigned = buildHistory(
    toHistoryRows(catAssignedRes.data, "category_id", "assigned_cents"),
  );
  const grpActivity = buildHistory(
    toHistoryRows(grpActivityRes.data, "group_id", "activity_cents"),
  );
  const grpAssigned = buildHistory(
    toHistoryRows(grpAssignedRes.data, "group_id", "assigned_cents"),
  );

  // Credit-card payment-category activity + register balances.
  const cardRegisterBalance = await loadCreditCardActivity(
    client,
    month,
    ccAccountMap,
    catActivity,
  );

  const { catTargets, grpTargets } = buildTargets(targetsRes.data);

  const rtaAvailableCents = computeReadyToAssign({
    rtaActivityCents: sumCents(rtaActivityRes.data, "activity_cents"),
    creditCardOpeningBalanceCents: sumCents(ccOpeningRes.data, "amount_cents"),
    totalSpendingAssignedCents:
      sumCents(allCatBudgetsRes.data, "assigned_cents") +
      sumCents(allGrpBudgetsRes.data, "assigned_cents"),
  });

  const budgetGroups = buildBudgetGroups({
    groups,
    month,
    catActivity,
    catAssigned,
    grpActivity,
    grpAssigned,
    catTargets,
    grpTargets,
    cardRegisterBalance,
  });

  return { month, rtaAvailableCents, groups: budgetGroups };
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

/**
 * Fetch credit-card transactions through `month`, inject their funded spending
 * into `catActivity`, and return each payment category's register balance
 * (negative = debt). Returns an empty map when there are no credit cards.
 */
async function loadCreditCardActivity(
  client: SupabaseClient,
  month: string,
  ccAccountMap: Map<string, string>,
  catActivity: MonthlyCents,
): Promise<Map<string, number>> {
  const cardRegisterBalance = new Map<string, number>();
  if (ccAccountMap.size === 0) return cardRegisterBalance;

  const accountIds = [...ccAccountMap.keys()];
  const through = nextBudgetMonth(month); // everything strictly before next month

  const [ccTxnsRes, ccAllTxnsRes] = await Promise.all([
    client
      .from("transactions")
      .select("account_id, amount_cents, txn_date, imported_id, transfer_account_id, transaction_allocations(id)")
      .in("account_id", accountIds)
      .not("approved_at", "is", null)
      .lt("txn_date", through),
    // ALL transactions (incl. unapproved) — register balance for the underfunded check.
    client
      .from("transactions")
      .select("account_id, amount_cents")
      .in("account_id", accountIds)
      .lt("txn_date", through),
  ]);

  for (const txn of (ccAllTxnsRes.data ?? []) as { account_id: string; amount_cents: number }[]) {
    const paymentCatId = ccAccountMap.get(txn.account_id);
    if (!paymentCatId) continue;
    cardRegisterBalance.set(
      paymentCatId,
      (cardRegisterBalance.get(paymentCatId) ?? 0) + txn.amount_cents,
    );
  }

  const ccTxns: CreditCardTxn[] = (
    (ccTxnsRes.data ?? []) as Array<{
      account_id: string;
      amount_cents: number;
      txn_date: string;
      imported_id: string | null;
      transfer_account_id: string | null;
      transaction_allocations: { id: string }[] | null;
    }>
  ).map((t) => ({
    accountId: t.account_id,
    amountCents: t.amount_cents,
    txnDate: t.txn_date,
    importedId: t.imported_id,
    isTransfer: !!t.transfer_account_id,
    hasAllocations: (t.transaction_allocations ?? []).length > 0,
  }));

  injectCreditCardActivity(catActivity, ccTxns, ccAccountMap);
  return cardRegisterBalance;
}

// ---------------------------------------------------------------------------
// Row-shape adapters (DB rows → normalized inputs for ./compute)
// ---------------------------------------------------------------------------

function toHistoryRows(
  rows: unknown[] | null,
  idKey: string,
  centsKey: string,
): HistoryRow[] {
  return ((rows ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row[idKey] as string,
    month: row.month as string,
    cents: row[centsKey] as number,
  }));
}

function sumCents(rows: unknown[] | null, centsKey: string): number {
  return ((rows ?? []) as Record<string, unknown>[]).reduce(
    (sum, row) => sum + (row[centsKey] as number),
    0,
  );
}

function buildTargets(rows: unknown[] | null): {
  catTargets: Record<string, TargetData>;
  grpTargets: Record<string, TargetData>;
} {
  const catTargets: Record<string, TargetData> = {};
  const grpTargets: Record<string, TargetData> = {};
  for (const row of (rows ?? []) as Array<{
    category_id: string | null;
    group_id: string | null;
    type: TargetData["type"];
    amount_cents: number;
    target_date: string | null;
  }>) {
    const target: TargetData = {
      type: row.type,
      amountCents: row.amount_cents,
      targetDate: row.target_date ?? null,
    };
    if (row.category_id) catTargets[row.category_id] = target;
    else if (row.group_id) grpTargets[row.group_id] = target;
  }
  return { catTargets, grpTargets };
}
