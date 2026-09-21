import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadAccountBalances } from "@/lib/ledger";

export type AccountListRow = {
  id: string;
  name: string;
  type: "checking" | "savings" | "credit" | "asset" | "liability";
  workingBalanceCents: number;
  isLinked: boolean;
  isActive: boolean;
};

// Same query the accounts list page's Server Component ran, exposed as JSON
// for the client-side query cache (lib/queries/accounts.ts).
export async function GET() {
  const supabase = await createClient();

  const [accountsRes, balances] = await Promise.all([
    supabase.from("accounts").select("*").order("name"),
    // Per-account balances aggregated in Postgres (account_balances view)
    // instead of fetching every transaction in the app to sum in JS.
    loadAccountBalances(supabase),
  ]);

  const accounts: AccountListRow[] = (accountsRes.data ?? []).map((acc) => ({
    id: acc.id as string,
    name: acc.name as string,
    type: acc.type as "checking" | "savings" | "credit" | "asset" | "liability",
    workingBalanceCents: balances.get(acc.id as string)?.workingCents ?? 0,
    isLinked: acc.is_linked as boolean,
    isActive: acc.is_active as boolean,
  }));

  return NextResponse.json({ accounts });
}
