import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadAccountBalances } from "@/lib/ledger";
import type { ItemConnection } from "@/lib/plaid/connection-health";
import { loadItemConnections } from "@/lib/plaid/item-status";

export type AccountListRow = {
  id: string;
  name: string;
  type: "checking" | "savings" | "credit" | "asset" | "liability";
  workingBalanceCents: number;
  isLinked: boolean;
  isActive: boolean;
  /** Bank-connection health for linked accounts; null when not linked. */
  connection: ItemConnection | null;
};

// Same query the accounts list page's Server Component ran, exposed as JSON
// for the client-side query cache (lib/queries/accounts.ts).
export async function GET() {
  const supabase = await createClient();

  const [accountsRes, balances, connections] = await Promise.all([
    supabase.from("accounts").select("*").order("name"),
    // Per-account balances aggregated in Postgres (account_balances view)
    // instead of fetching every transaction in the app to sum in JS.
    loadAccountBalances(supabase),
    loadItemConnections(supabase),
  ]);

  const accounts: AccountListRow[] = (accountsRes.data ?? []).map((acc) => ({
    id: acc.id as string,
    name: acc.name as string,
    type: acc.type as "checking" | "savings" | "credit" | "asset" | "liability",
    workingBalanceCents: balances.get(acc.id as string)?.workingCents ?? 0,
    isLinked: acc.is_linked as boolean,
    isActive: acc.is_active as boolean,
    connection: acc.plaid_item_id
      ? (connections.get(acc.plaid_item_id as string) ?? null)
      : null,
  }));

  return NextResponse.json({ accounts });
}
