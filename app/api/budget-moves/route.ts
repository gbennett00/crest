import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { MoveRow, MoveSource } from "@/lib/budget/moves-history";

const BUDGET_MONTH_RE = /^\d{4}-\d{2}-01$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Generous for one person's history; the page says when it's truncated.
const LIMIT = 500;

export type BudgetMovesResponse = {
  unitName: string;
  moves: MoveRow[];
  truncated: boolean;
};

type Named = { name: string; role?: string | null } | null;
type RawMove = {
  id: string;
  month: string;
  moved_at: string;
  amount_cents: number;
  source: MoveSource;
  from_category_id: string | null;
  from_group_id: string | null;
  to_category_id: string | null;
  to_group_id: string | null;
  from_category: Named;
  to_category: Named;
  from_group: Named;
  to_group: Named;
};

function sideName(named: Named): string {
  if (!named) return "Unknown";
  return named.role === "ready_to_assign" ? "Ready to Assign" : named.name;
}

// Budget moves into or out of one funding unit (?category= or ?group=),
// optionally limited to one budget month (?month=YYYY-MM-01), newest first.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const categoryId = params.get("category");
  const groupId = params.get("group");
  const rawMonth = params.get("month");
  const month = rawMonth && BUDGET_MONTH_RE.test(rawMonth) ? rawMonth : null;

  const unitId = categoryId ?? groupId;
  if (!unitId || !UUID_RE.test(unitId) || (categoryId && groupId)) {
    return NextResponse.json({ error: "Pass exactly one valid category or group id" }, { status: 400 });
  }
  const side = categoryId ? "category" : "group";

  const supabase = await createClient();

  let movesQuery = supabase
    .from("budget_moves")
    .select(
      `id, month, moved_at, amount_cents, source,
       from_category_id, from_group_id, to_category_id, to_group_id,
       from_category:categories!budget_moves_from_category_id_fkey(name, role),
       to_category:categories!budget_moves_to_category_id_fkey(name, role),
       from_group:category_groups!budget_moves_from_group_id_fkey(name),
       to_group:category_groups!budget_moves_to_group_id_fkey(name)`,
    )
    .or(`from_${side}_id.eq.${unitId},to_${side}_id.eq.${unitId}`)
    .order("moved_at", { ascending: false })
    .limit(LIMIT + 1);
  if (month) movesQuery = movesQuery.eq("month", month);

  const unitQuery = supabase
    .from(side === "category" ? "categories" : "category_groups")
    .select("name")
    .eq("id", unitId)
    .maybeSingle();

  const [movesRes, unitRes] = await Promise.all([movesQuery, unitQuery]);
  if (movesRes.error || unitRes.error) {
    const message = (movesRes.error ?? unitRes.error)!.message;
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const raw = (movesRes.data ?? []) as unknown as RawMove[];
  const moves: MoveRow[] = raw.slice(0, LIMIT).map((m) => ({
    id: m.id,
    month: m.month,
    movedAt: m.moved_at,
    amountCents: m.amount_cents,
    source: m.source,
    from: {
      id: (m.from_category_id ?? m.from_group_id)!,
      name: sideName(m.from_category ?? m.from_group),
    },
    to: {
      id: (m.to_category_id ?? m.to_group_id)!,
      name: sideName(m.to_category ?? m.to_group),
    },
  }));

  const body: BudgetMovesResponse = {
    unitName: (unitRes.data as { name: string } | null)?.name ?? "Category",
    moves,
    truncated: raw.length > LIMIT,
  };
  return NextResponse.json(body);
}
