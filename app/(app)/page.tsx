import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeAvailableThrough, currentBudgetMonth, OPENING_BALANCE_IMPORTED_ID } from "@/lib/ledger";
import { formatCents } from "@/lib/format";
import { ApproveForm } from "@/components/home/approve-form";
import type { CategoryOption } from "@/components/home/approve-form";
import { HomeAddTransaction } from "@/components/home/home-add-transaction";
import { HomeAssignButton } from "@/components/home/home-assign-button";
import type { AccountOption } from "@/components/transactions/add-transaction-form";
import type { BudgetData, BudgetGroup, BudgetCategory, TargetData } from "@/components/budget/budget-screen";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

export default function HomePage() {
  return (
    <div className="max-w-2xl">
      <Suspense fallback={<HomeSkeleton />}>
        <HomeContent />
      </Suspense>
    </div>
  );
}

async function HomeContent() {
  const supabase = await createClient();
  const month = currentBudgetMonth();

  const [
    pendingRes,
    groupsRes,
    catActivityRes,
    catAssignedRes,
    groupAssignedRes,
    categoriesRes,
    accountsRes,
    grpActivityRes,
    targetsRes,
  ] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, payee, amount_cents, txn_date, account_id, accounts!account_id(name)")
      .is("approved_at", null)
      .order("txn_date", { ascending: false })
      .limit(25),
    supabase
      .from("category_groups")
      .select("id, name, budget_mode, is_pinned, categories(id, name, role, is_pinned, is_hidden)"),
    supabase
      .from("category_monthly_activity")
      .select("category_id, month, activity_cents")
      .lte("month", month),
    supabase
      .from("category_monthly_assigned")
      .select("category_id, month, assigned_cents")
      .lte("month", month),
    // Group-mode assignments (keyed by group_id, all months)
    supabase
      .from("monthly_budgets")
      .select("group_id, month, assigned_cents")
      .not("group_id", "is", null),
    supabase
      .from("categories")
      .select("id, name, group_id, role, is_hidden, category_groups!group_id(name)")
      .eq("is_hidden", false)
      .order("name"),
    supabase
      .from("accounts")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("group_monthly_activity")
      .select("group_id, month, activity_cents")
      .lte("month", month),
    supabase
      .from("targets")
      .select("category_id, group_id, type, amount_cents, target_date"),
  ]);

  // Find RTA category ID
  let rtaId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outer: for (const g of (groupsRes.data ?? []) as any[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of (g.categories ?? []) as any[]) {
      if (c.role === "ready_to_assign") { rtaId = c.id as string; break outer; }
    }
  }

  // Fetch RTA activity (through today) and all spending assignments — for direct RTA formula
  const [rtaActivityRes, allCatBudgetsRes] = await Promise.all([
    rtaId
      ? supabase.from("category_monthly_activity")
          .select("activity_cents")
          .eq("category_id", rtaId)
          .lte("month", month)
      : Promise.resolve({ data: [] }),
    rtaId
      ? supabase.from("monthly_budgets")
          .select("assigned_cents")
          .not("category_id", "is", null)
          .neq("category_id", rtaId)
      : Promise.resolve({ data: [] }),
  ]);

  const rtaActivity = (rtaActivityRes.data ?? []).reduce(
    (s, r) => s + (r.activity_cents as number), 0,
  );
  const allCatAssigned = (allCatBudgetsRes.data ?? []).reduce(
    (s, r) => s + (r.assigned_cents as number), 0,
  );
  const allGrpAssigned = (groupAssignedRes.data ?? []).reduce(
    (s, r) => s + (r.assigned_cents as number), 0,
  );
  // rtaAvailableCents is computed below, after we know the credit-card opening
  // balances to exclude (see the CC section).

  // Build history maps for spending categories/groups
  const catActivityHistory: Record<string, Record<string, number>> = {};
  for (const row of catActivityRes.data ?? []) {
    (catActivityHistory[row.category_id as string] ??= {})[row.month as string] =
      row.activity_cents as number;
  }
  const catAssignedHistory: Record<string, Record<string, number>> = {};
  for (const row of catAssignedRes.data ?? []) {
    (catAssignedHistory[row.category_id as string] ??= {})[row.month as string] =
      row.assigned_cents as number;
  }
  // Group-level assignment history (keyed by group_id, through current month for overspent/pinned)
  const groupAssignedHistory: Record<string, Record<string, number>> = {};
  for (const row of groupAssignedRes.data ?? []) {
    (groupAssignedHistory[row.group_id as string] ??= {})[row.month as string] =
      row.assigned_cents as number;
  }

  // Inject credit card funded spending into payment category activity (same logic as budget page)
  const ccAccountsRes = await supabase
    .from("accounts")
    .select("id, payment_category_id")
    .eq("type", "credit")
    .not("payment_category_id", "is", null);

  const ccAccountMapHome = new Map<string, string>();
  for (const a of (ccAccountsRes.data ?? []) as { id: string; payment_category_id: string }[]) {
    ccAccountMapHome.set(a.id, a.payment_category_id);
  }

  // Exclude credit-card opening balances from RTA — pre-existing card debt is not
  // assignable cash, so it must not drag Ready to Assign negative (which would show
  // a false "Over assigned"). Mirrors the budget page; the debt instead surfaces as
  // an underfunded payment category.
  let ccOpeningBalanceTotal = 0;
  if (ccAccountMapHome.size > 0) {
    const ccOpeningRes = await supabase
      .from("transactions")
      .select("amount_cents")
      .in("account_id", [...ccAccountMapHome.keys()])
      .eq("imported_id", OPENING_BALANCE_IMPORTED_ID);
    ccOpeningBalanceTotal = (ccOpeningRes.data ?? []).reduce(
      (s, r) => s + (r.amount_cents as number), 0,
    );
  }
  const rtaAvailableCents =
    rtaActivity - ccOpeningBalanceTotal - allCatAssigned - allGrpAssigned;

  if (ccAccountMapHome.size > 0) {
    const ccTxnsRes = await supabase
      .from("transactions")
      .select("account_id, amount_cents, txn_date, imported_id, transfer_account_id, transaction_allocations(id)")
      .in("account_id", [...ccAccountMapHome.keys()])
      .not("approved_at", "is", null)
      .lte("txn_date", month + "-31"); // through current month

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const txn of (ccTxnsRes.data ?? []) as any[]) {
      const paymentCatId = ccAccountMapHome.get(txn.account_id as string);
      if (!paymentCatId) continue;
      if (txn.imported_id === OPENING_BALANCE_IMPORTED_ID) continue;
      const monthKey = (txn.txn_date as string).slice(0, 7) + "-01";
      const amount = txn.amount_cents as number;
      const isTransfer = !!(txn.transfer_account_id);
      const hasAllocations = ((txn.transaction_allocations as { id: string }[]) ?? []).length > 0;
      let contribution = 0;
      if (amount < 0 && !isTransfer && hasAllocations) contribution = Math.abs(amount);
      else if (amount > 0 && isTransfer) contribution = -amount;
      if (contribution !== 0) {
        (catActivityHistory[paymentCatId] ??= {})[monthKey] =
          (catActivityHistory[paymentCatId]?.[monthKey] ?? 0) + contribution;
      }
    }
  }

  // Compute available for each spending category/group (for overspent + pinned sections)
  type AvailItem = {
    id: string;
    name: string;
    groupId: string;
    groupName: string;
    availableCents: number;
    isPinned: boolean;
    isGroup: boolean;
  };

  const avails: AvailItem[] = [];

  for (const g of groupsRes.data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grp = g as any;
    const isGroupMode = grp.budget_mode === "group";

    if (isGroupMode) {
      // Group-mode: compute available at group level
      const groupActH: Record<string, number> = {};
      for (const c of (grp.categories ?? []) as { id: string; is_hidden: boolean; role: string | null }[]) {
        if (c.is_hidden || c.role === "ready_to_assign") continue;
        const actH = catActivityHistory[c.id] ?? {};
        for (const [m, v] of Object.entries(actH)) {
          groupActH[m] = (groupActH[m] ?? 0) + v;
        }
      }
      const groupAsnH = groupAssignedHistory[grp.id as string] ?? {};
      avails.push({
        id: grp.id as string,
        name: grp.name as string,
        groupId: grp.id as string,
        groupName: grp.name as string,
        availableCents: computeAvailableThrough(month, groupActH, groupAsnH),
        isPinned: grp.is_pinned as boolean,
        isGroup: true,
      });
    } else {
      // Category-mode: compute available per category
      for (const c of (grp.categories ?? []) as { id: string; name: string; role: string | null; is_pinned: boolean; is_hidden: boolean }[]) {
        if (c.is_hidden || c.role === "ready_to_assign") continue;
        avails.push({
          id: c.id,
          name: c.name,
          groupId: grp.id as string,
          groupName: grp.name as string,
          availableCents: computeAvailableThrough(
            month,
            catActivityHistory[c.id] ?? {},
            catAssignedHistory[c.id] ?? {},
          ),
          isPinned: c.is_pinned || (grp.is_pinned as boolean),
          isGroup: false,
        });
      }
    }
  }

  const overspent = avails
    .filter((c) => c.availableCents < 0)
    .sort((a, b) => a.availableCents - b.availableCents);

  const pinned = avails
    .filter((c) => c.isPinned)
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));

  // Categories for approval selector
  const categories: CategoryOption[] = (categoriesRes.data ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) => ({
      id: c.id as string,
      name: (c.role === "ready_to_assign" ? "Ready to Assign" : c.name) as string,
      groupName: c.role === "ready_to_assign"
        ? "— Inflows —"
        : (((c.category_groups as { name: string } | null)?.name) ?? "Other"),
    }),
  ).sort((a: CategoryOption, b: CategoryOption) => {
    if (a.groupName === "— Inflows —") return -1;
    if (b.groupName === "— Inflows —") return 1;
    return 0;
  });

  // Pending transactions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pending = (pendingRes.data ?? []).map((t: any) => ({
    id: t.id as string,
    payee: (t.payee as string) || "—",
    amountCents: t.amount_cents as number,
    txnDate: t.txn_date as string,
    accountName: (t.accounts as { name: string } | null)?.name ?? "Unknown",
  }));

  const accounts: AccountOption[] = (accountsRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
  }));

  // Build group activity history for the assign popup
  const grpActivityHistory: Record<string, Record<string, number>> = {};
  for (const row of grpActivityRes.data ?? []) {
    (grpActivityHistory[row.group_id as string] ??= {})[row.month as string] =
      row.activity_cents as number;
  }

  // Build targets lookups
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

  // Construct BudgetData to pass to the AssignPopup (reused from the budget screen)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const budgetGroups: BudgetGroup[] = (groupsRes.data ?? []).map((g: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cats: BudgetCategory[] = ((g.categories ?? []) as any[])
      .filter((c: { is_hidden: boolean }) => !c.is_hidden)
      .map((c: { id: string; name: string; role: string | null; is_pinned: boolean; is_hidden: boolean }) => ({
        id: c.id,
        name: c.name,
        role: (c.role as "ready_to_assign" | null) ?? null,
        isPinned: c.is_pinned,
        isHidden: c.is_hidden,
        assignedCents: catAssignedHistory[c.id]?.[month] ?? 0,
        activityCents: catActivityHistory[c.id]?.[month] ?? 0,
        availableCents: computeAvailableThrough(
          month,
          catActivityHistory[c.id] ?? {},
          catAssignedHistory[c.id] ?? {},
        ),
        target: catTargets[c.id] ?? null,
        cardRegisterBalanceCents: null,
      }));
    return {
      id: g.id as string,
      name: g.name as string,
      budgetMode: g.budget_mode as "category" | "group",
      isPinned: g.is_pinned as boolean,
      categories: cats,
      groupAssignedCents: groupAssignedHistory[g.id as string]?.[month] ?? 0,
      groupActivityCents: grpActivityHistory[g.id as string]?.[month] ?? 0,
      groupAvailableCents: computeAvailableThrough(
        month,
        grpActivityHistory[g.id as string] ?? {},
        groupAssignedHistory[g.id as string] ?? {},
      ),
      target: grpTargets[g.id as string] ?? null,
    };
  });

  const budgetData: BudgetData = { month, rtaAvailableCents, groups: budgetGroups };

  const hasItems = pending.length > 0 || overspent.length > 0 || rtaAvailableCents !== 0;
  const showRtaRow = rtaAvailableCents !== 0;
  const showPendingRow = pending.length > 0;

  return (
    <div className="p-4 space-y-5">
      {/* Page title */}
      <h1 className="text-2xl font-bold tracking-tight">Your Plan</h1>

      {/* Action card */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-2">
          <p className="text-base font-semibold">
            {hasItems ? "A few things to do" : "Lookin’ good!"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hasItems ? "Take care of these when you get a chance" : "You’re all caught up"}
          </p>
        </div>

        {/* Row 1: Pending transactions — only shown when there are some */}
        {showPendingRow && (
          <div className="flex items-center gap-3 px-4 py-2.5 border-t">
            <span className="text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
              {pending.length}
            </span>
            <span className="flex-1 text-sm">New transactions</span>
            <Link
              href="#pending"
              className="text-xs font-semibold bg-primary text-primary-foreground px-3 py-1 rounded-full shrink-0"
            >
              Review
            </Link>
          </div>
        )}

        {/* Row 2: Ready to Assign — hidden when exactly $0 */}
        {showRtaRow && (
          <div className="flex items-center gap-3 px-4 py-2.5 border-t">
            <span
              className={cn(
                "text-xs font-bold px-2 h-6 rounded-full flex items-center shrink-0 tabular-nums",
                rtaAvailableCents > 0
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {formatCents(rtaAvailableCents)}
            </span>
            <span className="flex-1 text-sm">
              {rtaAvailableCents < 0 ? "Over assigned" : "Ready to assign"}
            </span>
            {rtaAvailableCents < 0 ? (
              <Link
                href="/budget"
                className="text-xs font-semibold bg-destructive text-destructive-foreground px-3 py-1 rounded-full shrink-0"
              >
                Fix
              </Link>
            ) : (
              <HomeAssignButton data={budgetData} />
            )}
          </div>
        )}
      </div>

      {/* Overspent */}
      {overspent.length > 0 && (
        <Section title="Overspent" count={overspent.length} accent="red">
          <div className="divide-y">
            {overspent.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.isGroup ? "Group budget" : item.groupName}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-destructive">
                  {formatCents(item.availableCents)}
                </p>
              </div>
            ))}
          </div>
          <div className="px-4 pb-3">
            <Link
              href="/budget"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              Fix in Budget <ChevronRight size={12} />
            </Link>
          </div>
        </Section>
      )}

      {/* Pending approval */}
      {pending.length > 0 && (
        <Section
          id="pending"
          title="Needs Approval"
          count={pending.length}
          accent="amber"
        >
          <div className="divide-y">
            {pending.map((txn) => (
              <div key={txn.id} className="py-3 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{txn.payee}</p>
                    <p className="text-xs text-muted-foreground">
                      {txn.accountName} · {formatDate(txn.txnDate)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={cn(
                        "text-sm font-medium tabular-nums",
                        txn.amountCents < 0 ? "text-destructive" : "text-green-600 dark:text-green-400",
                      )}
                    >
                      {formatCents(txn.amountCents)}
                    </p>
                  </div>
                </div>
                {categories.length > 0 && (
                  <ApproveForm
                    transactionId={txn.id}
                    amountCents={txn.amountCents}
                    categories={categories}
                  />
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Pinned categories */}
      {pinned.length > 0 && (
        <Section title="Pinned" count={pinned.length}>
          <div className="divide-y">
            {pinned.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.isGroup ? "Group budget" : item.groupName}
                  </p>
                </div>
                <span
                  className={cn(
                    "text-xs font-semibold tabular-nums px-2.5 py-1 rounded-full",
                    item.availableCents < 0
                      ? "bg-destructive/10 text-destructive"
                      : item.availableCents === 0
                        ? "bg-muted text-muted-foreground"
                        : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
                  )}
                >
                  {formatCents(item.availableCents)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Floating Add Transaction button */}
      <HomeAddTransaction accounts={accounts} categories={categories} />
    </div>
  );
}

function Section({
  id,
  title,
  count,
  accent,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  accent?: "amber" | "red";
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="border rounded-xl overflow-hidden">
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 border-b",
          accent === "amber" && "bg-amber-50 dark:bg-amber-950/20",
          accent === "red" && "bg-destructive/5",
        )}
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        {count !== undefined && (
          <span
            className={cn(
              "text-xs font-medium px-1.5 py-0.5 rounded-full",
              accent === "amber" &&
                "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
              accent === "red" && "bg-destructive/10 text-destructive",
              !accent && "bg-muted text-muted-foreground",
            )}
          >
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function HomeSkeleton() {
  return (
    <div className="p-4 animate-pulse space-y-5">
      <div className="h-8 bg-muted rounded w-1/3" />
      <div className="h-28 bg-muted rounded-xl" />
      {[1, 2].map((i) => (
        <div key={i} className="h-24 bg-muted rounded-xl" />
      ))}
    </div>
  );
}
