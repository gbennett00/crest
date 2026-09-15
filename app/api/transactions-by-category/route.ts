import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Same query the transactions page's Server Component ran, exposed as JSON so
// the client-side query cache (see lib/queries/transactions.ts) can fetch a
// category/month on-demand instead of a full RSC round-trip.
export async function GET(request: NextRequest) {
  const categoryId = request.nextUrl.searchParams.get("category");
  const monthFilter = request.nextUrl.searchParams.get("month") || undefined;

  if (!categoryId) {
    return NextResponse.json({ categoryName: "Category", txns: [] });
  }

  const supabase = await createClient();

  // Month bounds for the DB-side filter (half-open [monthFilter, nextMonth)).
  const nextMonth = (() => {
    if (!monthFilter) return null;
    const [y, m] = monthFilter.split("-").map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  })();

  const [categoryRes, txnRes] = await Promise.all([
    supabase.from("categories").select("id, name").eq("id", categoryId).single(),
    (() => {
      // Root at transactions (not allocations) so txn_date is a top-level
      // column we can filter and sort on in Postgres. The !inner join keeps
      // only transactions with an allocation to this category, embedding
      // just that allocation.
      let q = supabase
        .from("transactions")
        .select(
          "id, payee, amount_cents, txn_date, approved_at, cleared_at, memo, " +
            "accounts!transactions_account_id_fkey(name), " +
            "transaction_allocations!inner(amount_cents, category_id)",
        )
        .eq("transaction_allocations.category_id", categoryId)
        .order("txn_date", { ascending: false });
      if (monthFilter && nextMonth) {
        q = q.gte("txn_date", monthFilter).lt("txn_date", nextMonth);
      }
      return q;
    })(),
  ]);

  const categoryName = (categoryRes.data as { name: string } | null)?.name ?? "Category";
  const txns = txnRes.data ?? [];

  return NextResponse.json({ categoryName, txns });
}
