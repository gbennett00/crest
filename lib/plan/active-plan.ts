import type { SupabaseClient } from "@supabase/supabase-js";

import { LedgerError } from "@/lib/ledger";

/**
 * The plan (budget workspace) the current request operates on.
 *
 * Authorization is enforced at the DB level by RLS (`user_can_access_plan`), so
 * a query/insert can never touch a plan the user isn't a member of. This helper
 * resolves *which* of the user's plans is active for write paths that must stamp
 * a NOT NULL `plan_id` (e.g. creating an account or category group).
 *
 * For now each user belongs to exactly one plan (provisioned by the
 * `on_auth_user_created` trigger), so we return that membership. When one user
 * can own multiple plans, this becomes a cookie-backed selector instead.
 */
export async function getActivePlanId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client
    .from("plan_members")
    .select("plan_id")
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
