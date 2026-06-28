import { NextRequest, NextResponse } from "next/server";
import * as jose from "jose";

import { createPlaidClient } from "@/lib/plaid/client";
import { syncItem } from "@/lib/plaid/sync";
import { createServiceClient } from "@/lib/supabase/service";

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
      await syncItem(supabase, itemRow as never);
    }
  }

  if (body.webhook_type === "ITEM") {
    const statusMap: Record<string, string> = {
      ERROR: "error",
      PENDING_EXPIRATION: "login_required",
      USER_PERMISSION_REVOKED: "revoked",
    };
    const status = statusMap[body.webhook_code];
    if (status) {
      await supabase
        .from("plaid_items")
        .update({
          status,
          error_code: body.error?.error_code ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("plaid_item_id", body.item_id);
    }
  }

  return NextResponse.json({ received: true });
}
