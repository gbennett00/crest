import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeAvailableThrough, currentBudgetMonth } from "@/lib/ledger";
import { formatCents } from "@/lib/format";
import { ApproveForm } from "@/components/home/approve-form";
import type { CategoryOption } from "@/components/home/approve-form";
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
    // Group-mode assignments live in monthly_budgets with group_id set
    supabase
      .from("monthly_budgets")
      .select("group_id, month, assigned_cents")
      .not("group_id", "is", null)
      .lte("month", month),
    supabase
      .from("categories")
      .select("id, name, group_id, role, is_hidden, category_groups!group_id(name)")
      .eq("is_hidden", false)
      .order("name"),
  ]);

  // Build history maps
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
  // Group-level assignment history (keyed by group_id)
  const groupAssignedHistory: Record<string, Record<string, number>> = {};
  for (const row of groupAssignedRes.data ?? []) {
    (groupAssignedHistory[row.group_id as string] ??= {})[row.month as string] =
      row.assigned_cents as number;
  }

  // Compute available for each category/group, plus RTA
  type AvailItem = {
    id: string;
    name: string;
    groupId: string;
    groupName: string;
    availableCents: number;
    isPinned: boolean;
    isGroup: boolean;
  };

  let rtaAvailableCents = 0;
  const avails: AvailItem[] = [];

  for (const g of groupsRes.data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grp = g as any;
    const isGroupMode = grp.budget_mode === "group";

    if (isGroupMode) {
      // Compute available at group level: sum category activities + group assignments
      const groupActH: Record<string, number> = {};
      for (const c of (grp.categories ?? []) as { id: string; is_hidden: boolean; role: string | null }[]) {
        if (c.is_hidden || c.role === "ready_to_assign") continue;
        const actH = catActivityHistory[c.id] ?? {};
        for (const [m, v] of Object.entries(actH)) {
          groupActH[m] = (groupActH[m] ?? 0) + v;
        }
      }
      const groupAsnH = groupAssignedHistory[grp.id as string] ?? {};
      const available = computeAvailableThrough(month, groupActH, groupAsnH);
      avails.push({
        id: grp.id as string,
        name: grp.name as string,
        groupId: grp.id as string,
        groupName: grp.name as string,
        availableCents: available,
        isPinned: grp.is_pinned as boolean,
        isGroup: true,
      });
    } else {
      // Category-mode: compute available per category
      for (const c of (grp.categories ?? []) as { id: string; name: string; role: string | null; is_pinned: boolean; is_hidden: boolean }[]) {
        if (c.is_hidden) continue;
        const actH = catActivityHistory[c.id] ?? {};
        const asnH = catAssignedHistory[c.id] ?? {};
        const available = computeAvailableThrough(month, actH, asnH);
        if (c.role === "ready_to_assign") {
          rtaAvailableCents = available;
          continue;
        }
        avails.push({
          id: c.id,
          name: c.name,
          groupId: grp.id as string,
          groupName: grp.name as string,
          availableCents: available,
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

  const hasItems = pending.length > 0 || overspent.length > 0;

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

        {/* Row 1: Pending transactions */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-t">
          <span
            className={cn(
              "text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center shrink-0",
              pending.length > 0
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {pending.length}
          </span>
          <span className="flex-1 text-sm">New transactions</span>
          {pending.length > 0 && (
            <Link
              href="#pending"
              className="text-xs font-semibold bg-primary text-primary-foreground px-3 py-1 rounded-full shrink-0"
            >
              Review
            </Link>
          )}
        </div>

        {/* Row 2: Ready to Assign */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-t">
          <span
            className={cn(
              "text-xs font-bold px-2 h-6 rounded-full flex items-center shrink-0 tabular-nums",
              rtaAvailableCents > 0
                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {formatCents(rtaAvailableCents)}
          </span>
          <span className="flex-1 text-sm">Ready to assign</span>
          <Link
            href="/budget"
            className="text-xs font-semibold bg-primary text-primary-foreground px-3 py-1 rounded-full shrink-0"
          >
            Assign
          </Link>
        </div>
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
