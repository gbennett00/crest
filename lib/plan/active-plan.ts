import type { SupabaseClient } from "@supabase/supabase-js";

import { LedgerError } from "@/lib/ledger";

/**
 * The plan (budget workspace) the current request operates on.
 *
 * A user may belong to several plans (their own, plus any they've been invited
 * to), but only one is *active* at a time. The active plan is stored in the
 * database (`user_active_plan`, changed via `set_active_plan` or by accepting an
 * invitation) and RLS exposes only that plan's rows, so every read is already
 * scoped to it. That also means `plan_members` yields exactly one row here: the
 * active plan, which this helper returns for write paths that must stamp a NOT
 * NULL `plan_id` (e.g. creating an account or category group).
 */
export async function getActivePlanId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client
    .from("plan_members")
    .select("plan_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new LedgerError("db_error", error.message);
  }
  if (!data) {
    throw new LedgerError("plan_missing", "No plan found for the current user");
  }

  return data.plan_id as string;
}
