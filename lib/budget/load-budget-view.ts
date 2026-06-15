import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import {
  currentBudgetMonth,
  nextBudgetMonth,
  previousBudgetMonth,
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
 * Ready to Assign is a per-month figure. Inflows categorized to RTA and the
 * credit-card opening balances backed out of the pool are always measured
 * through the *viewed* month, so an earlier view never counts later money.
 *
 * Spending assignments use a sliding window matching YNAB: for the previous,
 * current, and next month, *all* assignments are subtracted (so assigning next
 * month's money reduces this month's RTA and can't be double-assigned). For any
 * month older than the previous month, only assignments through that month are
 * subtracted, so historical months read as the self-contained snapshots they
 * were instead of being dragged negative by later assignments.
 *
 * `month` is clamped to `[minMonth, maxMonth]` (earliest activity → next month);
 * those bounds are returned so the UI can gate navigation.
 */
export async function loadBudgetView(
  client: SupabaseClient,
  requestedMonth: string,
): Promise<BudgetData> {
  const maxMonth = nextBudgetMonth(currentBudgetMonth());
  const month = requestedMonth > maxMonth ? maxMonth : requestedMonth;

  // Wave 1: everything needed to render spending categories/groups, plus the
  // earliest transaction/assignment used to compute the lower navigation bound.
  const [
    groupsRes,
    catActivityRes,
    catAssignedRes,
    grpActivityRes,
    grpAssignedRes,
    targetsRes,
    ccAccountsRes,
    firstTxnRes,
    firstBudgetRes,
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
    client
      .from("transactions")
      .select("txn_date")
      .order("txn_date", { ascending: true })
      .limit(1),
    client
      .from("monthly_budgets")
      .select("month")
      .order("month", { ascending: true })
      .limit(1),
  ]);

  // Navigation bounds: viewable from the earliest transaction/assignment month
  // through next month. Falls back to the current month for an empty budget.
  const firstTxnDate = (firstTxnRes.data?.[0] as { txn_date: string } | undefined)?.txn_date;
  const firstBudgetMonth = (firstBudgetRes.data?.[0] as { month: string } | undefined)?.month;
  const monthCandidates = [
    firstTxnDate ? `${firstTxnDate.slice(0, 7)}-01` : undefined,
    firstBudgetMonth,
  ].filter((m): m is string => !!m);
  const minMonth = monthCandidates.length
    ? monthCandidates.reduce((a, b) => (a < b ? a : b))
    : currentBudgetMonth();

  const groups = (groupsRes.data ?? []) as unknown as RawGroup[];
  const rtaId = findReadyToAssignId(groups);

  const ccAccountMap = new Map<string, string>(); // accountId → paymentCategoryId
  for (const a of (ccAccountsRes.data ?? []) as { id: string; payment_category_id: string }[]) {
    ccAccountMap.set(a.id, a.payment_category_id);
  }
  const ccAccountIds = [...ccAccountMap.keys()];

  // Wave 2: RTA inputs. Inflows and the CC-opening back-out are bounded by the
  // viewed month. Spending assignments are bounded only when viewing a month
  // older than the previous month; the previous/current/next window sees all
  // assignments, so future commitments reduce today's RTA (see the docstring).
  const snapshotAssignments = month < previousBudgetMonth(currentBudgetMonth());
  const afterViewedMonth = nextBudgetMonth(month); // exclusive upper bound

  let catBudgetsQuery = client
    .from("monthly_budgets")
    .select("assigned_cents")
    .not("category_id", "is", null)
    .neq("category_id", rtaId ?? "");
  let grpBudgetsQuery = client
    .from("monthly_budgets")
    .select("assigned_cents")
    .not("group_id", "is", null);
  if (snapshotAssignments) {
    catBudgetsQuery = catBudgetsQuery.lte("month", month);
    grpBudgetsQuery = grpBudgetsQuery.lte("month", month);
  }

  const [rtaActivityRes, allCatBudgetsRes, allGrpBudgetsRes, ccOpeningRes] =
    await Promise.all([
      rtaId
        ? client
            .from("category_monthly_activity")
            .select("activity_cents")
            .eq("category_id", rtaId)
            .lte("month", month)
        : Promise.resolve({ data: [] }),
      rtaId ? catBudgetsQuery : Promise.resolve({ data: [] }),
      grpBudgetsQuery,
      ccAccountIds.length > 0
        ? client
            .from("transactions")
            .select("amount_cents")
            .in("account_id", ccAccountIds)
            .eq("imported_id", OPENING_BALANCE_IMPORTED_ID)
            .lt("txn_date", afterViewedMonth)
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

  return { month, minMonth, maxMonth, rtaAvailableCents, groups: budgetGroups };
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
