import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { currentBudgetMonth } from "@/lib/ledger";
import { getBudgetView, loadCategoryOptions } from "@/lib/budget";
import { createServerTimer } from "@/lib/server-timing";
import type { AccountOption } from "@/components/transactions/transaction-form";

const BUDGET_MONTH_RE = /^\d{4}-\d{2}-01$/;

// Same query the budget page's Server Component runs, exposed as JSON so the
// client-side query cache (see lib/queries/budget.ts) can fetch a month
// on-demand — for cache misses, background revalidation, and the prefetch of
// neighbouring months — without a full RSC round-trip.
export async function GET(request: NextRequest) {
  const rawMonth = request.nextUrl.searchParams.get("month") ?? undefined;
  const month = BUDGET_MONTH_RE.test(rawMonth ?? "") ? rawMonth! : currentBudgetMonth();

  const timer = createServerTimer("/api/budget-view");
  const supabase = await createClient();
  try {
    const [data, accountsRes, categories] = await Promise.all([
      timer.time("budget", () => getBudgetView(month)),
      timer.time("accounts", () =>
        supabase.from("accounts").select("id, name").eq("is_active", true).order("name"),
      ),
      timer.time("categories", () => loadCategoryOptions(supabase)),
    ]);

    const accounts: AccountOption[] = (accountsRes.data ?? []).map((a) => ({
      id: a.id as string,
      name: a.name as string,
    }));

    timer.log({ month });
    return NextResponse.json(
      { data, accounts, categories },
      { headers: { "Server-Timing": timer.header() } },
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
