import { NextRequest, NextResponse } from "next/server";

import { deriveConnectionHealth } from "@/lib/plaid/connection-health";
import {
  healthInputFromRow,
  ITEM_HEALTH_COLUMNS,
  refreshItemStatus,
  type ItemHealthRow,
} from "@/lib/plaid/item-status";
import { sendPushToPlan } from "@/lib/push";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Daily connection-health check (Vercel Cron, see vercel.json).
 *
 * Webhooks cover Items that break loudly (ITEM: ERROR etc.), but a connection
 * that quietly stops reaching the bank sends nothing at all: no new data means
 * no SYNC_UPDATES_AVAILABLE. Calling /item/get for every Item refreshes
 * last_successful_update / last_failed_update so "delayed" can be detected, and
 * catches errors whose webhook was missed.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; requests without it are refused.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("plaid_items")
    .select(`${ITEM_HEALTH_COLUMNS}, access_token, plan_id`)
    .neq("status", "revoked");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as (ItemHealthRow & { access_token: string; plan_id: string })[];
  let checked = 0;
  let failed = 0;
  let newlyNeedsRepair = 0;

  for (const row of rows) {
    const before = deriveConnectionHealth(healthInputFromRow(row));
    let after: ReturnType<typeof deriveConnectionHealth>;
    try {
      const patch = await refreshItemStatus(supabase, row);
      after = deriveConnectionHealth(healthInputFromRow({ ...row, ...patch } as ItemHealthRow));
      checked++;
    } catch (e) {
      failed++;
      console.error(`[plaid health-check] item ${row.plaid_item_id} failed`, e);
      continue;
    }

    // Webhooks already push for the errors they report, and they update the row
    // first, so this only fires for problems the check itself discovered.
    // "Delayed" never pushes: it resolves on its own.
    if (after.state === "needs_repair" && before.state !== "needs_repair") {
      newlyNeedsRepair++;
      try {
        await sendPushToPlan(supabase, row.plan_id, {
          title: "Bank connection needs repair",
          body: `${row.institution_name ?? "A bank connection"} needs you to reconnect it`,
          url: "/accounts",
        });
      } catch (e) {
        console.error(`[plaid health-check] push failed for item ${row.plaid_item_id}`, e);
      }
    }
  }

  return NextResponse.json({ checked, failed, newlyNeedsRepair });
}
