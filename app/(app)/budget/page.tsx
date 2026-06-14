import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { computeAvailableThrough, currentBudgetMonth, nextBudgetMonth, OPENING_BALANCE_IMPORTED_ID } from "@/lib/ledger";
import { BudgetScreen } from "@/components/budget/budget-screen";
import type { BudgetCategory, BudgetData, BudgetGroup, TargetData } from "@/components/budget/budget-screen";

const BUDGET_MONTH_RE = /^\d{4}-\d{2}-01$/;

export default function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  return (
    <Suspense fallback={<BudgetSkeleton />}>
      <BudgetContent searchParams={searchParams} />
    </Suspense>
  );
}

async function BudgetContent({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: rawMonth } = await searchParams;
  const month = BUDGET_MONTH_RE.test(rawMonth ?? "") ? rawMonth! : currentBudgetMonth();
  const todayMonth = currentBudgetMonth();

  const supabase = await createClient();

  // Wave 1: all the data needed to render spending categories/groups
  const [groupsRes, catActivityRes, catAssignedRes, grpActivityRes, grpAssignedRes, targetsRes, ccAccountsRes] =
    await Promise.all([
      supabase
        .from("category_groups")
        .select(
          "id, name, budget_mode, is_pinned, categories(id, name, role, is_pinned, is_hidden)",
        )
        .order("is_pinned", { ascending: false })
        .order("name"),
      supabase
        .from("category_monthly_activity")
        .select("category_id, month, activity_cents")
        .lte("month", month),
      supabase
        .from("category_monthly_assigned")
        .select("category_id, month, assigned_cents")
        .lte("month", month),
      supabase
        .from("group_monthly_activity")
        .select("group_id, month, activity_cents")
        .lte("month", month),
      supabase
        .from("group_monthly_assigned")
        .select("group_id, month, assigned_cents")
        .lte("month", month),
      supabase
        .from("targets")
        .select("category_id, group_id, type, amount_cents, target_date"),
      // Credit card accounts: we need to compute payment category activity separately
      // because CC purchases are allocated to spending categories, not the payment category.
      supabase
        .from("accounts")
        .select("id, payment_category_id")
        .eq("type", "credit")
        .not("payment_category_id", "is", null),
    ]);

  // Find RTA category ID from the groups data (synchronous — no extra round trip)
  let rtaId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outer: for (const g of (groupsRes.data ?? []) as any[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of (g.categories ?? []) as any[]) {
      if (c.role === "ready_to_assign") { rtaId = c.id as string; break outer; }
    }
  }

  const ccAccountIds = ((ccAccountsRes.data ?? []) as { id: string }[]).map((a) => a.id);

  // Wave 2: RTA-specific queries — activity through today, all spending assignments ever
  const [rtaActivityRes, allCatBudgetsRes, allGrpBudgetsRes, ccOpeningRes] = await Promise.all([
    rtaId
      ? supabase
          .from("category_monthly_activity")
          .select("activity_cents")
          .eq("category_id", rtaId)
          .lte("month", todayMonth)
      : Promise.resolve({ data: [] }),
    rtaId
      ? supabase
          .from("monthly_budgets")
          .select("assigned_cents")
          .not("category_id", "is", null)
          .neq("category_id", rtaId)
      : Promise.resolve({ data: [] }),
    supabase
      .from("monthly_budgets")
      .select("assigned_cents")
      .not("group_id", "is", null),
    // Credit-card opening balances are categorized to RTA (matching YNAB's register),
    // but pre-existing card debt must not reduce assignable cash — fetch them so we
    // can back them out of the RTA total below. The debt instead surfaces as an
    // underfunded payment category.
    ccAccountIds.length > 0
      ? supabase
          .from("transactions")
          .select("amount_cents")
          .in("account_id", ccAccountIds)
          .eq("imported_id", OPENING_BALANCE_IMPORTED_ID)
      : Promise.resolve({ data: [] }),
  ]);

  // RTA = total inflows through today − credit-card opening balances − total spending
  // assignments (any month). CC opening balances are negative, so subtracting them
  // adds the debt back out of the assignable-cash pool.
  const rtaActivity = (rtaActivityRes.data ?? []).reduce(
    (s, r) => s + (r.activity_cents as number), 0,
  );
  const ccOpeningBalanceTotal = (ccOpeningRes.data ?? []).reduce(
    (s, r) => s + (r.amount_cents as number), 0,
  );
  const totalSpendingAssigned =
    (allCatBudgetsRes.data ?? []).reduce((s, r) => s + (r.assigned_cents as number), 0) +
    (allGrpBudgetsRes.data ?? []).reduce((s, r) => s + (r.assigned_cents as number), 0);
  const rtaAvailableCents = rtaActivity - ccOpeningBalanceTotal - totalSpendingAssigned;

  // Build history maps for spending categories/groups
  const catActivityHistory: Record<string, Record<string, number>> = {};
  for (const row of catActivityRes.data ?? []) {
    (catActivityHistory[row.category_id as string] ??= {})[row.month as string] =
      row.activity_cents as number;
  }

  // Credit card: inject funded spending into payment category activity.
  // Purchases on the card (approved, categorized, non-transfer) fill the payment
  // category automatically. Payments made to the card (transfer inflows) drain it.
  // Opening balance transactions are excluded — those represent pre-existing debt
  // that the user must manually fund by assigning to the payment category.
  const ccAccountMap = new Map<string, string>(); // accountId → paymentCategoryId
  for (const a of (ccAccountsRes.data ?? []) as { id: string; payment_category_id: string }[]) {
    ccAccountMap.set(a.id, a.payment_category_id);
  }
  // paymentCategoryId → card register balance (sum of all transactions on the card through `month`)
  const ccRegisterBalance = new Map<string, number>();
  if (ccAccountMap.size > 0) {
    const ccTxnsRes = await supabase
      .from("transactions")
      .select("account_id, amount_cents, txn_date, imported_id, transfer_account_id, transaction_allocations(id)")
      .in("account_id", [...ccAccountMap.keys()])
      .not("approved_at", "is", null)
      .lt("txn_date", nextBudgetMonth(month)); // everything through the displayed month

    // Fetch ALL transactions (including unapproved) for register balance comparison
    const ccAllTxnsRes = await supabase
      .from("transactions")
      .select("account_id, amount_cents")
      .in("account_id", [...ccAccountMap.keys()])
      .lt("txn_date", nextBudgetMonth(month));

    for (const txn of (ccAllTxnsRes.data ?? []) as { account_id: string; amount_cents: number }[]) {
      const paymentCatId = ccAccountMap.get(txn.account_id);
      if (!paymentCatId) continue;
      ccRegisterBalance.set(paymentCatId, (ccRegisterBalance.get(paymentCatId) ?? 0) + txn.amount_cents);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const txn of (ccTxnsRes.data ?? []) as any[]) {
      const paymentCatId = ccAccountMap.get(txn.account_id as string);
      if (!paymentCatId) continue;
      if (txn.imported_id === OPENING_BALANCE_IMPORTED_ID) continue;

      const monthKey = (txn.txn_date as string).slice(0, 7) + "-01";
      const amount = txn.amount_cents as number;
      const isTransfer = !!(txn.transfer_account_id);
      const hasAllocations = ((txn.transaction_allocations as { id: string }[]) ?? []).length > 0;

      let contribution = 0;
      if (amount < 0 && !isTransfer && hasAllocations) {
        contribution = Math.abs(amount);
      } else if (amount > 0 && isTransfer) {
        contribution = -amount;
      }

      if (contribution !== 0) {
        (catActivityHistory[paymentCatId] ??= {})[monthKey] =
          (catActivityHistory[paymentCatId]?.[monthKey] ?? 0) + contribution;
      }
    }

  }

  const catAssignedHistory: Record<string, Record<string, number>> = {};
  for (const row of catAssignedRes.data ?? []) {
    (catAssignedHistory[row.category_id as string] ??= {})[row.month as string] =
      row.assigned_cents as number;
  }

  const grpActivityHistory: Record<string, Record<string, number>> = {};
  for (const row of grpActivityRes.data ?? []) {
    (grpActivityHistory[row.group_id as string] ??= {})[row.month as string] =
      row.activity_cents as number;
  }

  const grpAssignedHistory: Record<string, Record<string, number>> = {};
  for (const row of grpAssignedRes.data ?? []) {
    (grpAssignedHistory[row.group_id as string] ??= {})[row.month as string] =
      row.assigned_cents as number;
  }

  // Build targets lookup
  const catTargets: Record<string, TargetData> = {};
  const grpTargets: Record<string, TargetData> = {};
  for (const t of targetsRes.data ?? []) {
    const td: TargetData = {
      type: t.type as TargetData["type"],
      amountCents: t.amount_cents as number,
      targetDate: (t.target_date as string) ?? null,
    };
    if (t.category_id) catTargets[t.category_id as string] = td;
    else if (t.group_id) grpTargets[t.group_id as string] = td;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups: BudgetGroup[] = (groupsRes.data ?? []).map((g: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sortedCats = [...(g.categories ?? [])].sort((a: any, b: any) => {
      if (a.is_pinned !== b.is_pinned) return Number(b.is_pinned) - Number(a.is_pinned);
      return (a.name as string).localeCompare(b.name as string);
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const categories: BudgetCategory[] = sortedCats.map((c: any) => {
      const actHistory = catActivityHistory[c.id as string] ?? {};
      const asnHistory = catAssignedHistory[c.id as string] ?? {};
      // RTA available is computed separately above; skip it in the regular rollover
      const availableCents = c.role === "ready_to_assign"
        ? 0 // placeholder — RTA not shown as a budget row
        : computeAvailableThrough(month, actHistory, asnHistory);
      return {
        id: c.id as string,
        name: c.name as string,
        role: (c.role as "ready_to_assign" | null) ?? null,
        isPinned: c.is_pinned as boolean,
        isHidden: c.is_hidden as boolean,
        assignedCents: asnHistory[month] ?? 0,
        activityCents: actHistory[month] ?? 0,
        availableCents,
        target: catTargets[c.id as string] ?? null,
        cardRegisterBalanceCents: ccRegisterBalance.get(c.id as string) ?? null,
      };
    });

    return {
      id: g.id as string,
      name: g.name as string,
      budgetMode: g.budget_mode as "category" | "group",
      isPinned: g.is_pinned as boolean,
      categories,
      groupAssignedCents: grpAssignedHistory[g.id as string]?.[month] ?? 0,
      groupActivityCents: grpActivityHistory[g.id as string]?.[month] ?? 0,
      groupAvailableCents: computeAvailableThrough(
        month,
        grpActivityHistory[g.id as string] ?? {},
        grpAssignedHistory[g.id as string] ?? {},
      ),
      target: grpTargets[g.id as string] ?? null,
    };
  });

  const budgetData: BudgetData = { month, rtaAvailableCents, groups };
  return <BudgetScreen data={budgetData} />;
}

function BudgetSkeleton() {
  return (
    <div className="animate-pulse p-4 space-y-3">
      <div className="h-11 bg-muted rounded" />
      <div className="h-20 bg-muted rounded-lg" />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 bg-muted rounded" />
        ))}
      </div>
    </div>
  );
}
