import type { SupabaseClient } from "@supabase/supabase-js";

import { LedgerError } from "@/lib/ledger";

/** Cookie holding the plan the user is currently viewing (see the plan switcher). */
export const ACTIVE_PLAN_COOKIE = "crest_active_plan_id";

/**
 * The plan (budget workspace) the current request operates on.
 *
 * Authorization is enforced at the DB level by RLS (`user_can_access_plan`), so
 * a query/insert can never touch a plan the user isn't a member of. This helper
 * resolves *which* of the user's plans is active for write paths that must stamp
 * a NOT NULL `plan_id` (e.g. creating an account or category group).
 *
 * A user may now belong to more than one plan (their own, plus any they've been
 * invited to). The active plan is selected by the `crest_active_plan_id` cookie
 * when set and still valid; otherwise we fall back to the user's oldest
 * membership (their original personal plan). Reading the cookie is best-effort —
 * outside a request scope (e.g. unit tests) it's simply skipped.
 */
export async function getActivePlanId(client: SupabaseClient): Promise<string> {
  const preferred = await readActivePlanCookie();
  if (preferred) {
    const { data } = await client
      .from("plan_members")
      .select("plan_id")
      .eq("plan_id", preferred)
      .maybeSingle();
    if (data) return data.plan_id as string;
  }

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

/**
 * Read the active-plan cookie if we're inside a request scope. Uses a dynamic
 * import of `next/headers` and swallows the "outside request scope" error so
 * this module stays usable from pure contexts (tests, scripts).
 */
async function readActivePlanCookie(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return store.get(ACTIVE_PLAN_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}
