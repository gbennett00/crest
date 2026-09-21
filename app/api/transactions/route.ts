import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AccountOption, CategoryOption } from "@/components/transactions/transaction-form";

export type AllTransactionsRow = {
  id: string;
  payee: string | null;
  amountCents: number;
  txnDate: string;
  approved: boolean;
  cleared: boolean;
  reconciled: boolean;
  memo: string | null;
  categoryLabel: string;
  accountId: string;
  accountName: string;
};

export type AllTransactionsResponse = {
  txns: AllTransactionsRow[];
  hasMore: boolean;
  accountOptions: AccountOption[];
  categoryOptions: CategoryOption[];
};

// No full-text index on payee/memo/category and no pagination UI anywhere
// else in the app (the account register hard-caps at 200 the same way) — a
// generous flat window keeps this simple and fast enough at
// personal-budgeting scale. `hasMore` tells the UI to hint that filters can
// narrow things down.
const PAGE_LIMIT = 300;

// Simple search: matches if the term appears in the payee, the memo, or any
// allocated category's name — no field-scoping in the UI, so one path covers
// all three.
function matchesSearch(
  txn: {
    payee: string | null;
    memo: string | null;
    transaction_allocations?: { categories: { name: string } | null }[];
  },
  needle: string,
): boolean {
  const payee = (txn.payee ?? "").toLowerCase();
  const memo = (txn.memo ?? "").toLowerCase();
  const categoryNames = (txn.transaction_allocations ?? []).map((a) =>
    (a.categories?.name ?? "").toLowerCase(),
  );
  return payee.includes(needle) || memo.includes(needle) || categoryNames.some((n) => n.includes(needle));
}

// Dollar string -> integer cents, or null if blank/invalid.
function parseDollarsToCents(value: string): number | null {
  const cents = Math.round(parseFloat(value) * 100);
  return isNaN(cents) ? null : cents;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim() || "";
  const accountId = params.get("account") || "";
  const categoryId = params.get("category") || "";
  const dateFrom = params.get("dateFrom") || "";
  const dateTo = params.get("dateTo") || "";
  const amountMinRaw = params.get("amountMin") || "";
  const amountMaxRaw = params.get("amountMax") || "";

  const supabase = await createClient();

  let query = supabase
    .from("transactions")
    .select(
      "id, payee, amount_cents, txn_date, approved_at, cleared_at, reconciled_at, memo, account_id, " +
        "accounts!transactions_account_id_fkey(name), " +
        "transaction_allocations(amount_cents, category_id, categories(name))",
    )
    .order("txn_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(PAGE_LIMIT + 1);

  if (accountId) query = query.eq("account_id", accountId);
  if (dateFrom) query = query.gte("txn_date", dateFrom);
  if (dateTo) query = query.lte("txn_date", dateTo);

  // Amount is a range on magnitude, not signed value, so a $20-$50 search
  // finds both a $32 expense and a $32 refund: match [min, max] on either
  // side of zero. An open end (only min or only max given) matches out to
  // the corresponding extreme.
  const amountMin = amountMinRaw ? parseDollarsToCents(amountMinRaw) : null;
  const amountMax = amountMaxRaw ? parseDollarsToCents(amountMaxRaw) : null;
  if (amountMin !== null || amountMax !== null) {
    const lo = amountMin ?? 0;
    const hi = amountMax ?? Number.MAX_SAFE_INTEGER;
    query = query.or(
      `and(amount_cents.gte.${lo},amount_cents.lte.${hi}),and(amount_cents.gte.${-hi},amount_cents.lte.${-lo})`,
    );
  }

  const [txnsRes, categoriesRes, accountsRes] = await Promise.all([
    query,
    supabase
      .from("categories")
      .select("id, name, role, category_groups!group_id(name)")
      .eq("is_hidden", false)
      .order("name"),
    supabase.from("accounts").select("id, name").eq("is_active", true).order("name"),
  ]);

  if (txnsRes.error) {
    return NextResponse.json({ error: txnsRes.error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows = (txnsRes.data ?? []) as any[];

  if (categoryId) {
    rows = rows.filter((t) =>
      t.transaction_allocations?.some(
        (a: { category_id: string }) => a.category_id === categoryId,
      ),
    );
  }
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((t) => matchesSearch(t, needle));
  }

  const hasMore = rows.length > PAGE_LIMIT;
  const page = rows.slice(0, PAGE_LIMIT);

  const txns: AllTransactionsRow[] = page.map((txn) => {
    const allocs: { category_id: string; amount_cents: number; categories: { name: string } | null }[] =
      txn.transaction_allocations ?? [];
    const categoryLabel =
      allocs.length === 0
        ? "Uncategorized"
        : allocs.length === 1
          ? (allocs[0].categories?.name ?? "Unknown")
          : `Split (${allocs.length})`;
    const accountData = Array.isArray(txn.accounts) ? txn.accounts[0] : txn.accounts;
    return {
      id: txn.id as string,
      payee: (txn.payee as string) ?? null,
      amountCents: txn.amount_cents as number,
      txnDate: txn.txn_date as string,
      approved: !!txn.approved_at,
      cleared: !!txn.cleared_at,
      reconciled: !!txn.reconciled_at,
      memo: (txn.memo as string) ?? null,
      categoryLabel,
      accountId: txn.account_id as string,
      accountName: accountData?.name ?? "Unknown",
    };
  });

  const accountOptions: AccountOption[] = ((accountsRes.data ?? []) as { id: string; name: string }[]).map(
    (a) => ({ id: a.id, name: a.name }),
  );
  const categoryOptions: CategoryOption[] = (
    (categoriesRes.data ?? []) as unknown as Array<{
      id: string;
      name: string;
      role: string | null;
      category_groups: { name: string } | null;
    }>
  ).map((c) => ({
    id: c.id,
    name: c.role === "ready_to_assign" ? "Ready to Assign" : c.name,
    groupName: c.role === "ready_to_assign" ? "— Inflows —" : c.category_groups?.name ?? "Other",
  }));

  const response: AllTransactionsResponse = { txns, hasMore, accountOptions, categoryOptions };
  return NextResponse.json(response);
}
