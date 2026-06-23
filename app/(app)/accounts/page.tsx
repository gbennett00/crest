import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { workingBalanceCents } from "@/lib/ledger";
import { AccountCard } from "@/components/accounts/account-card";
import { AddAccountForm } from "@/components/accounts/add-account-form";
import { LinkAccountButton } from "@/components/accounts/link-account-button";
import { TransactionForm } from "@/components/transactions/transaction-form";
import type { AccountData } from "@/components/accounts/account-card";
import type { CategoryOption } from "@/components/transactions/transaction-form";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function AccountsPage() {
  return (
    <div className="max-w-2xl p-4 space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
      <Suspense fallback={<AccountsSkeleton />}>
        <AccountsContent />
      </Suspense>
    </div>
  );
}

async function AccountsContent() {
  const supabase = await createClient();

  const [accountsRes, txnsRes, categoriesRes] = await Promise.all([
    supabase
      .from("accounts")
      .select("*")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("transactions")
      .select("account_id, amount_cents, cleared_at"),
    supabase
      .from("categories")
      .select("id, name, group_id, role, is_hidden, category_groups!group_id(name)")
      .eq("is_hidden", false)
      .order("name"),
  ]);

  // Group transaction amount lines by account
  const txnsByAccount: Record<
    string,
    { amountCents: number; clearedAt: string | null }[]
  > = {};
  for (const row of txnsRes.data ?? []) {
    (txnsByAccount[row.account_id as string] ??= []).push({
      amountCents: row.amount_cents as number,
      clearedAt: row.cleared_at as string | null,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const categories: CategoryOption[] = (categoriesRes.data ?? []).map((c: any) => ({
    id: c.id as string,
    name: c.role === "ready_to_assign" ? "Ready to Assign" : (c.name as string),
    groupName: c.role === "ready_to_assign" ? "— Inflows —" : (((c.category_groups as { name: string } | null)?.name) ?? "Other"),
  })).sort((a: CategoryOption, b: CategoryOption) => {
    if (a.groupName === "— Inflows —") return -1;
    if (b.groupName === "— Inflows —") return 1;
    return 0;
  });

  const accountOptions = (accountsRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
  }));

  const accounts: AccountData[] = (accountsRes.data ?? []).map((acc) => {
    const lines = txnsByAccount[acc.id as string] ?? [];
    return {
      id: acc.id as string,
      name: acc.name as string,
      type: acc.type as "checking" | "savings" | "credit",
      workingBalanceCents: workingBalanceCents(lines),
      isLinked: acc.is_linked as boolean,
    };
  });

  // Group accounts by type
  const cashAccounts = accounts.filter((a) => a.type === "checking" || a.type === "savings");
  const creditAccounts = accounts.filter((a) => a.type === "credit");

  const cashTotal = cashAccounts.reduce((s, a) => s + a.workingBalanceCents, 0);
  const creditTotal = creditAccounts.reduce((s, a) => s + a.workingBalanceCents, 0);

  if (accounts.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2 flex-wrap">
          <AddAccountForm />
          <LinkAccountButton />
        </div>
        <TransactionForm accounts={accountOptions} categories={categories} />
        <p className="text-sm text-muted-foreground py-8 text-center">
          No accounts yet. Add one above or link a bank account to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <AddAccountForm />
        <LinkAccountButton />
      </div>
      <TransactionForm accounts={accountOptions} categories={categories} />

      {/* Cash accounts */}
      {cashAccounts.length > 0 && (
        <AccountGroup
          title="Cash"
          total={cashTotal}
          accounts={cashAccounts}
        />
      )}

      {/* Credit accounts */}
      {creditAccounts.length > 0 && (
        <AccountGroup
          title="Credit"
          total={creditTotal}
          accounts={creditAccounts}
        />
      )}
    </div>
  );
}

function AccountGroup({
  title,
  total,
  accounts,
}: {
  title: string;
  total: number;
  accounts: AccountData[];
}) {
  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            total < 0 ? "text-destructive" : "",
          )}
        >
          {formatCents(total)}
        </span>
      </div>
      <div className="divide-y">
        {accounts.map((account) => (
          <AccountCard key={account.id} account={account} />
        ))}
      </div>
    </div>
  );
}

function AccountsSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-24 bg-muted rounded-xl" />
      ))}
    </div>
  );
}
