import { NextRequest, NextResponse } from "next/server";

import { refreshItemStatus } from "@/lib/plaid/item-status";
import { createServiceClient } from "@/lib/supabase/service";

// Vercel caps a function's run time; give the batch as long as the plan allows.
export const maxDuration = 60;

/** /item/get calls in flight at once: fast enough for many Items, gentle on Plaid. */
const CONCURRENCY = 8;

/**
 * Daily connection-health check (Vercel Cron, see vercel.json).
 *
 * Webhooks cover Items that break loudly (ITEM: ERROR etc.), but a connection
 * that quietly stops reaching the bank sends nothing at all: no new data means
 * no SYNC_UPDATES_AVAILABLE. Calling /item/get for every Item refreshes
 * last_successful_update / last_failed_update so "delayed" can be detected, and
 * catches errors whose webhook was missed. The "needs repair" push is sent by
 * applyItemPatch, only on the transition into that state.
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
    .select("plaid_item_id, access_token")
    .neq("status", "revoked");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data ?? []) as { plaid_item_id: string; access_token: string }[];
  let checked = 0;
  let failed = 0;

  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      try {
        await refreshItemStatus(supabase, item, { notify: true });
        checked++;
      } catch (e) {
        failed++;
        console.error(`[plaid health-check] item ${item.plaid_item_id} failed`, e);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  return NextResponse.json({ checked, failed });
}
