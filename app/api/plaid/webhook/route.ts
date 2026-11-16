import { NextRequest, NextResponse } from "next/server";
import * as jose from "jose";

import { createPlaidClient } from "@/lib/plaid/client";
import {
  applyItemPatch,
  statusPatchFromError,
  syncItemAndRefreshStatus,
  type ItemStatusPatch,
} from "@/lib/plaid/item-status";
import { createServiceClient } from "@/lib/supabase/service";
import { sendPushToPlan } from "@/lib/push";

const PLAID_WEBHOOK_VERIFICATION_ENABLED =
  process.env.NODE_ENV === "production" ||
  process.env.PLAID_VERIFY_WEBHOOKS === "true";

async function verifyWebhook(
  rawBody: string,
  verificationHeader: string,
): Promise<boolean> {
  if (!PLAID_WEBHOOK_VERIFICATION_ENABLED) return true;

  try {
    const decodedHeader = jose.decodeProtectedHeader(verificationHeader);
    if (decodedHeader.alg !== "ES256" || !decodedHeader.kid) return false;

    const plaid = createPlaidClient();
    const keyResponse = await plaid.webhookVerificationKeyGet({
      key_id: decodedHeader.kid,
    });
    const jwk = keyResponse.data.key;
    const key = await jose.importJWK(jwk as jose.JWK, "ES256");

    const { payload } = await jose.jwtVerify(verificationHeader, key, {
      algorithms: ["ES256"],
      clockTolerance: 300,
    });

    const bodyHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawBody),
    );
    const expectedHash = Buffer.from(bodyHash).toString("hex");
    const claimedHash = payload.request_body_sha256 as string | undefined;

    if (!claimedHash) return false;
    return expectedHash === claimedHash;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const verificationHeader = request.headers.get("Plaid-Verification") ?? "";

  const verified = await verifyWebhook(rawBody, verificationHeader);
  if (!verified) {
    return NextResponse.json({ error: "Verification failed" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as {
    webhook_type: string;
    webhook_code: string;
    item_id: string;
    error?: { error_code: string; error_message: string } | null;
  };

  const supabase = createServiceClient();

  if (
    body.webhook_type === "TRANSACTIONS" &&
    body.webhook_code === "SYNC_UPDATES_AVAILABLE"
  ) {
    const { data: itemRow } = await supabase
      .from("plaid_items")
      .select("*")
      .eq("plaid_item_id", body.item_id)
      .single();

    if (itemRow) {
      let result: Awaited<ReturnType<typeof syncItemAndRefreshStatus>>;
      try {
        result = await syncItemAndRefreshStatus(supabase, itemRow as never, { notify: true });
      } catch (e) {
        console.error(`[plaid webhook] sync failed for item ${body.item_id}`, e);
        return NextResponse.json({ error: "Sync failed" }, { status: 500 });
      }

      // The sync already succeeded and saved its cursor; a push failure must not
      // turn that into a 500 (Plaid would retry the webhook for nothing).
      if (result.addedCount > 0) {
        try {
          const planId = (itemRow as { plan_id: string }).plan_id;
          await sendPushToPlan(supabase, planId, {
            title: "New transactions",
            body: `${result.addedCount} new transaction${result.addedCount === 1 ? "" : "s"} to review`,
            url: "/#pending",
          });
        } catch (e) {
          console.error(`[plaid webhook] push failed for item ${body.item_id}`, e);
        }
      }
    }
  }

  if (body.webhook_type === "ITEM") {
    await handleItemWebhook(supabase, body);
  }

  return NextResponse.json({ received: true });
}

/**
 * ITEM webhooks drive the "needs repair" side of connection health (see
 * lib/plaid/connection-health.ts). applyItemPatch sends the push, and only when
 * the Item newly needs repair, so a repeated ERROR, or a warning the daily
 * check already reported, doesn't page the user again.
 */
async function handleItemWebhook(
  supabase: ReturnType<typeof createServiceClient>,
  body: {
    webhook_code: string;
    item_id: string;
    error?: { error_code: string; error_message: string } | null;
  },
) {
  let patch: ItemStatusPatch;

  switch (body.webhook_code) {
    case "ERROR": {
      const code = body.error?.error_code ?? null;
      patch = code ? statusPatchFromError(code) : { status: "error" };
      break;
    }
    // Access ends in ~7 days (PENDING_DISCONNECT for US/CA, PENDING_EXPIRATION
    // for UK/EU). Plaid sends this once, so it is recorded on its own column
    // whatever state the Item is in; status and error_code are left alone.
    case "PENDING_DISCONNECT":
    case "PENDING_EXPIRATION":
      patch = { disconnect_warned_at: new Date().toISOString() };
      break;
    case "USER_PERMISSION_REVOKED":
      patch = { status: "revoked" };
      break;
    // A login error was fixed from another app sharing the same bank login.
    // That doesn't renew consent, so any expiry warning stays.
    case "LOGIN_REPAIRED":
      patch = { status: "good", error_code: null };
      break;
    default:
      return;
  }

  await applyItemPatch(supabase, body.item_id, patch, { notify: true });
}
