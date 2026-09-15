import type { SupabaseClient } from "@supabase/supabase-js";

export type NetWorthPoint = {
  month: string;
  /** Sum of every account with a non-negative balance. */
  assetsCents: number;
  /** Sum of every account with a negative balance (kept negative). */
  debtsCents: number;
  netCents: number;
};

type BalanceRow = { account_id: string; month: string; balance_cents: number };

/**
 * Carries each account's balance forward through months with no activity
 * (`account_monthly_balance` only has a row for a month something happened),
 * then buckets each month's per-account balances into assets (>= 0) vs.
 * debts (< 0). `months` must be ascending.
 */
export function computeNetWorthSeries(
  balanceRows: BalanceRow[],
  accountIds: string[],
  months: string[],
): NetWorthPoint[] {
  const rowsByAccount = new Map<string, BalanceRow[]>();
  for (const id of accountIds) rowsByAccount.set(id, []);
  for (const row of balanceRows) {
    rowsByAccount.get(row.account_id)?.push(row);
  }
  for (const rows of rowsByAccount.values()) rows.sort((a, b) => (a.month < b.month ? -1 : 1));

  const nextIndex = new Map<string, number>();
  const lastKnownCents = new Map<string, number>();
  for (const id of accountIds) {
    nextIndex.set(id, 0);
    lastKnownCents.set(id, 0);
  }

  return months.map((month) => {
    for (const id of accountIds) {
      const rows = rowsByAccount.get(id)!;
      let i = nextIndex.get(id)!;
      while (i < rows.length && rows[i].month <= month) {
        lastKnownCents.set(id, rows[i].balance_cents);
        i++;
      }
      nextIndex.set(id, i);
    }

    let assetsCents = 0;
    let debtsCents = 0;
    for (const id of accountIds) {
      const cents = lastKnownCents.get(id)!;
      if (cents >= 0) assetsCents += cents;
      else debtsCents += cents;
    }
    return { month, assetsCents, debtsCents, netCents: assetsCents + debtsCents };
  });
}

export async function loadNetWorthSeries(
  client: SupabaseClient,
  months: string[],
): Promise<NetWorthPoint[]> {
  if (months.length === 0) return [];
  const maxMonth = months[months.length - 1];

  const accountsRes = await client.from("accounts").select("id").eq("is_active", true);
  const accountIds = ((accountsRes.data ?? []) as { id: string }[]).map((a) => a.id);
  if (accountIds.length === 0) {
    return months.map((month) => ({ month, assetsCents: 0, debtsCents: 0, netCents: 0 }));
  }

  const { data } = await client
    .from("account_monthly_balance")
    .select("account_id, month, balance_cents")
    .in("account_id", accountIds)
    .lte("month", maxMonth);

  return computeNetWorthSeries((data ?? []) as BalanceRow[], accountIds, months);
}
