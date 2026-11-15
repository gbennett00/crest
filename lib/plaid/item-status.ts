/**
 * Keeps plaid_items' connection-health columns in step with Plaid, and reads
 * them back as a per-Item health summary for the UI.
 *
 * The pure pieces (patch builders) are exported for tests; the rest talk to
 * Plaid and Supabase.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemGetResponse } from "plaid";

import { createPlaidClient } from "./client";
import {
  deriveConnectionHealth,
  isRevokedErrorCode,
  type ConnectionHealthInput,
  type ItemConnection,
  type PlaidItemStatus,
} from "./connection-health";
import { syncItem } from "./sync";

export type { ItemConnection };

export type ItemStatusPatch = {
  status?: PlaidItemStatus;
  error_code?: string | null;
  last_successful_update?: string | null;
  last_failed_update?: string | null;
  consent_expiration_time?: string | null;
  status_checked_at?: string;
};

/** The Plaid error code on a failed Plaid API call (axios error), if any. */
export function plaidErrorCode(err: unknown): string | null {
  const data = (err as { response?: { data?: { error_code?: unknown } } } | null)?.response
    ?.data;
  return typeof data?.error_code === "string" ? data.error_code : null;
}

/** Patch for a successful /item/get. */
export function statusPatchFromItemGet(
  currentStatus: string,
  response: Pick<ItemGetResponse, "item" | "status">,
  now: Date = new Date(),
): ItemStatusPatch {
  const errorCode = response.item.error?.error_code ?? null;
  const tx = response.status?.transactions;

  let status: PlaidItemStatus;
  if (errorCode) {
    status = isRevokedErrorCode(errorCode) ? "revoked" : "error";
  } else if (currentStatus === "pending_disconnect") {
    // /item/get can't tell us the PENDING_DISCONNECT warning has passed (it may
    // not come with a consent_expiration_time); only a successful update-mode
    // run clears it (see markItemRepaired).
    status = "pending_disconnect";
  } else {
    // /item/get succeeded with no error, so the Item works: this also clears a
    // stale 'error' or 'revoked' (e.g. LOGIN_REPAIRED was missed).
    status = "good";
  }

  return {
    status,
    error_code: errorCode,
    last_successful_update: tx?.last_successful_update ?? null,
    last_failed_update: tx?.last_failed_update ?? null,
    consent_expiration_time: response.item.consent_expiration_time ?? null,
    status_checked_at: now.toISOString(),
  };
}

/** Patch for a Plaid API call on this Item that failed with `errorCode`. */
export function statusPatchFromError(errorCode: string): ItemStatusPatch {
  return {
    status: isRevokedErrorCode(errorCode) ? "revoked" : "error",
    error_code: errorCode,
  };
}

type ItemRef = { plaid_item_id: string; access_token: string; status: string };

async function applyPatch(
  client: SupabaseClient,
  plaidItemId: string,
  patch: ItemStatusPatch,
): Promise<void> {
  const { error } = await client
    .from("plaid_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("plaid_item_id", plaidItemId);
  if (error) throw new Error(error.message);
}

/**
 * Calls /item/get and records the Item's error, update timestamps and consent
 * expiry. A Plaid error from /item/get itself (e.g. ITEM_NOT_FOUND) is
 * recorded too rather than thrown; anything else is thrown.
 */
export async function refreshItemStatus(
  client: SupabaseClient,
  item: ItemRef,
): Promise<ItemStatusPatch> {
  const plaid = createPlaidClient();
  let patch: ItemStatusPatch;
  try {
    const res = await plaid.itemGet({ access_token: item.access_token });
    patch = statusPatchFromItemGet(item.status, res.data);
  } catch (e) {
    const code = plaidErrorCode(e);
    if (!code) throw e;
    patch = { ...statusPatchFromError(code), status_checked_at: new Date().toISOString() };
  }
  await applyPatch(client, item.plaid_item_id, patch);
  return patch;
}

/** Records the error code from a failed Plaid call on this Item, if it was a Plaid error. */
export async function recordItemError(
  client: SupabaseClient,
  plaidItemId: string,
  err: unknown,
): Promise<void> {
  const code = plaidErrorCode(err);
  if (!code) return;
  await applyPatch(client, plaidItemId, statusPatchFromError(code));
}

/** After a successful update-mode Link session: the Item is usable again. */
export async function markItemRepaired(
  client: SupabaseClient,
  plaidItemId: string,
): Promise<void> {
  await applyPatch(client, plaidItemId, { status: "good", error_code: null });
}

/**
 * syncItem, plus keeping connection health current: a Plaid error from the
 * sync is recorded on the Item (then rethrown), and a successful sync is
 * followed by a /item/get refresh. A refresh failure is logged, never thrown —
 * the sync itself already succeeded and saved its cursor.
 */
export async function syncItemAndRefreshStatus(
  client: SupabaseClient,
  itemRow: Parameters<typeof syncItem>[1] & { status: string },
): Promise<Awaited<ReturnType<typeof syncItem>>> {
  let result: Awaited<ReturnType<typeof syncItem>>;
  try {
    result = await syncItem(client, itemRow);
  } catch (e) {
    try {
      await recordItemError(client, itemRow.plaid_item_id, e);
    } catch (recordErr) {
      console.error("[plaid] failed to record item error", recordErr);
    }
    throw e;
  }

  try {
    await refreshItemStatus(client, itemRow);
  } catch (e) {
    console.error(`[plaid] status refresh failed for item ${itemRow.plaid_item_id}`, e);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reading health back for the UI
// ---------------------------------------------------------------------------

export const ITEM_HEALTH_COLUMNS =
  "plaid_item_id, institution_name, status, error_code, last_successful_update, last_failed_update, consent_expiration_time, status_checked_at, created_at";

export type ItemHealthRow = {
  plaid_item_id: string;
  institution_name: string | null;
  status: string;
  error_code: string | null;
  last_successful_update: string | null;
  last_failed_update: string | null;
  consent_expiration_time: string | null;
  status_checked_at: string | null;
  created_at: string;
};

export function healthInputFromRow(row: ItemHealthRow): ConnectionHealthInput {
  return {
    status: row.status,
    errorCode: row.error_code,
    lastSuccessfulUpdate: row.last_successful_update,
    lastFailedUpdate: row.last_failed_update,
    consentExpirationTime: row.consent_expiration_time,
    statusCheckedAt: row.status_checked_at,
    createdAt: row.created_at,
  };
}

export function itemConnectionFromRow(row: ItemHealthRow, now: Date = new Date()): ItemConnection {
  return {
    ...deriveConnectionHealth(healthInputFromRow(row), now),
    plaidItemId: row.plaid_item_id,
    institutionName: row.institution_name,
    lastSuccessfulUpdate: row.last_successful_update,
  };
}

/** Connection health for every Plaid Item the client can see, keyed by plaid_item_id. */
export async function loadItemConnections(
  client: SupabaseClient,
): Promise<Map<string, ItemConnection>> {
  const { data, error } = await client.from("plaid_items").select(ITEM_HEALTH_COLUMNS);
  if (error) throw new Error(error.message);
  const now = new Date();
  return new Map(
    ((data ?? []) as ItemHealthRow[]).map((row) => [
      row.plaid_item_id,
      itemConnectionFromRow(row, now),
    ]),
  );
}
